import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Full-stack Uno test: two real accounts create a heads-up table and play it
 * over HTTP — ready-up, dealing, turn gating, drawing, wild colours, the UNO
 * call window, the timeout auto-play and hand masking. The rules themselves
 * are unit-tested; here the point is that Uno runs on the same table system
 * as poker.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Uno tables (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49179${suffix}`;
  const phoneB = `+49180${suffix}`;

  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  const post = (
    path: string,
    token: string,
    body: Record<string, unknown> = {},
  ) => {
    const agent = request(app.getHttpServer()).post(`/api${path}`);
    if (token) {
      agent.set('Authorization', `Bearer ${token}`);
    }
    return agent.send(body);
  };

  const snapshot = async (token: string) =>
    (await get(`/tables/${tableId}`, token).expect(200)).body;

  const myIdOf = (token: string) => (token === tokenA ? idA : idB);

  /** The colour a player holds most of — what a human picks for a wild. */
  const bestColor = (hand: string[]) => {
    const counts: Record<string, number> = { R: 0, Y: 0, G: 0, B: 0 };
    for (const card of hand) {
      const color = card.charAt(0);
      if (color !== 'W') {
        counts[color] += 1;
      }
    }
    return (['R', 'Y', 'G', 'B'] as const).reduce(
      (best, color) => (counts[color] > counts[best] ? color : best),
      'R' as 'R' | 'Y' | 'G' | 'B',
    );
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror main.ts so the test exercises the real routing + validation.
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const registerA = await post('/auth/register', '', {
      phoneNumber: phoneA,
      password: 'uno-e2e-pass',
      displayName: 'Uno Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'uno-e2e-pass',
      displayName: 'Uno Beta',
    }).expect(201);
    tokenB = registerB.body.accessToken;
    idB = registerB.body.user.id;
  }, 30_000);

  afterAll(async () => {
    try {
      await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    } catch {
      /* table may already be gone */
    }
    try {
      await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    } catch {
      /* table may already be gone */
    }
    const dataSource = app.get(DataSource);
    await dataSource.getRepository(User).delete({ id: In([idA, idB]) });
    await app.close();
  });

  it('opens an Uno table and seats two players', async () => {
    const created = await post('/games/uno/tables', tokenA, {
      name: 'E2E Uno table',
      maxSeats: 2,
    }).expect(201);
    tableId = created.body.id as number;
    expect(created.body.gameSlug).toBe('uno');
    expect(created.body.game.kind).toBe('uno');
    expect(created.body.game.phase).toBe('waiting');
    expect(created.body.game.players).toEqual([]);
    // Uno tables carry no blinds.
    expect(created.body.smallBlind).toBeNull();

    const joined = await post(`/tables/${tableId}/join`, tokenB).expect(201);
    expect(joined.body.seats).toHaveLength(2);
    expect(
      joined.body.seats.every((seat: { stack: number }) => seat.stack === 0),
    ).toBe(true);
  }, 15_000);

  it('refuses more seats than Uno can hold', async () => {
    const rejected = await post('/games/uno/tables', tokenA, {
      name: 'Too big',
      maxSeats: 7,
    });
    expect(rejected.status).toBe(400);
  }, 15_000);

  it('deals seven cards each once both players are ready', async () => {
    const oneReady = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);
    expect(oneReady.body.game.phase).toBe('waiting');
    expect(
      oneReady.body.seats.find((seat: { userId: number }) => seat.userId === idA)
        .ready,
    ).toBe(true);

    const started = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    const game = started.body.game;
    expect(game.phase).toBe('playing');
    expect(game.gameNumber).toBe(1);
    expect(game.turnUserId).toBe(idA);
    expect(game.direction).toBe(1);
    expect(game.discardTop).not.toBeNull();
    expect(['R', 'Y', 'G', 'B']).toContain(game.activeColor);
    // 108 cards: 7 each, one flipped, the rest still in the pile.
    expect(game.drawCount).toBe(93);
    expect(game.pendingUno).toBeNull();
    // Every card the table offers is one the player actually holds.
    expect(
      game.legal.playable.every((card: string) =>
        started.body.game.hand.includes(card),
      ),
    ).toBe(true);
    // Ready flags cleared for the next game.
    expect(
      started.body.seats.every((seat: { ready: boolean }) => !seat.ready),
    ).toBe(true);
  }, 15_000);

  it('never sends anyone else\u2019s hand to the browser', async () => {
    const viewA = await snapshot(tokenA);
    const viewB = await snapshot(tokenB);

    expect(viewA.game.hand).toHaveLength(7);
    expect(viewB.game.hand).toHaveLength(7);
    // Two different hands off one deck.
    expect(viewA.game.hand).not.toEqual(viewB.game.hand);

    for (const view of [viewA, viewB]) {
      for (const player of view.game.players) {
        expect(player).not.toHaveProperty('hand');
        expect(player.cardCount).toBe(7);
      }
    }
    // Your own hand is exactly as long as the seat says it is.
    expect(
      viewA.game.players.find(
        (player: { userId: number }) => player.userId === idA,
      ).cardCount,
    ).toBe(viewA.game.hand.length);
  }, 15_000);

  it('only lets the player on the clock act, and only Uno actions', async () => {
    const outOfTurn = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'draw',
    });
    expect(outOfTurn.status).toBe(400);
    expect(outOfTurn.body.message).toContain('not your turn');

    const pokerAction = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'fold',
    });
    expect(pokerAction.status).toBe(400);
    expect(pokerAction.body.message).toContain('part of Uno');

    // Passing before drawing is not a thing.
    const passTooEarly = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'pass',
    });
    expect(passTooEarly.status).toBe(400);
    expect(passTooEarly.body.message).toContain('Draw a card first');

    // The DTO rejects codes the deck does not contain.
    const bogusCard = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'play',
      card: 'ZZ',
    });
    expect(bogusCard.status).toBe(400);

    // A card nobody holds cannot be played.
    const view = await snapshot(tokenA);
    const stranger = ['R0', 'Y1', 'G2', 'B3', 'R4', 'Y5', 'G6', 'B7'].find(
      (card) => !view.game.hand.includes(card),
    ) as string;
    const notInHand = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'play',
      card: stranger,
    });
    expect(notInHand.status).toBe(400);
    expect(notInHand.body.message).toMatch(/not in your hand|does not match/);

    // Nothing above touched the game.
    expect((await snapshot(tokenA)).game.turnUserId).toBe(idA);
  }, 15_000);

  it('plays a real game over HTTP to completion', async () => {
    let actor = tokenA;
    let finished = false;

    for (let step = 0; step < 600 && !finished; step += 1) {
      const view = await snapshot(actor);
      const game = view.game;
      if (game.phase !== 'playing') {
        finished = game.phase === 'finished';
        break;
      }
      const myId = myIdOf(actor);

      // Off-turn actions: UNO call / catch / challenge
      if (game.legal.callUno) {
        await post(`/tables/${tableId}/action`, actor, { type: 'call_uno' }).expect(201);
        continue;
      }
      if (game.legal.catchUserId != null) {
        await post(`/tables/${tableId}/action`, actor, { type: 'catch_uno' }).expect(201);
        continue;
      }
      if (game.legal.challengeWf4) {
        // Accept the challenge (draw 4) to keep the game moving
        await post(`/tables/${tableId}/action`, actor, { type: 'challenge_wf4', accept: true }).expect(201);
        continue;
      }

      if (game.turnUserId !== myId) {
        actor = actor === tokenA ? tokenB : tokenA;
        continue;
      }

      if (game.legal.playable.length > 0) {
        const card = game.legal.playable[0] as string;
        const played = await post(`/tables/${tableId}/action`, actor, {
          type: 'play',
          card,
          ...(card.startsWith('W') ? { color: bestColor(game.hand) } : {}),
        }).expect(201);
        const after = played.body.game;
        expect(after.hand).toHaveLength(game.hand.length - 1);
        expect(after.discardTop).toBe(card);
        expect(['R', 'Y', 'G', 'B']).toContain(after.activeColor);
        if (after.phase === 'playing') {
          expect(after.turnUserId).not.toBeNull();
        }
      } else if (game.legal.draw) {
        const drew = await post(`/tables/${tableId}/action`, actor, { type: 'draw' }).expect(201);
        expect(drew.body.game.hand).toHaveLength(game.hand.length + 1);
        if (drew.body.game.legal.drawnCard != null) {
          expect(drew.body.game.legal.playable).toEqual([drew.body.game.legal.drawnCard]);
        }
      } else if (game.legal.pass) {
        await post(`/tables/${tableId}/action`, actor, { type: 'pass' }).expect(201);
      } else {
        actor = actor === tokenA ? tokenB : tokenA;
        continue;
      }
    }

    expect(finished).toBe(true);
    const final = await snapshot(tokenA);
    expect(final.game.phase).toBe('finished');
    expect(final.game.legal).toBeNull();
    expect(final.game.turnUserId).toBeNull();
    expect(final.game.pendingUno).toBeNull();
    expect([idA, idB]).toContain(final.game.winnerUserId);
    expect(final.game.winnerPoints).toBeGreaterThanOrEqual(0);
    const winner = final.game.players.find(
      (player: { userId: number }) => player.userId === final.game.winnerUserId,
    );
    expect(winner.cardCount).toBe(0);
  }, 120_000);

  it('deals a rematch and plays for a player whose clock ran out', async () => {
    await post(`/tables/${tableId}/action`, tokenA, { type: 'ready' }).expect(
      201,
    );
    const restarted = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    const game = restarted.body.game;
    expect(game.phase).toBe('playing');
    expect(game.gameNumber).toBe(2);
    // The starter rotates: seat 1 opens the second game.
    expect(game.turnUserId).toBe(idB);
    expect(restarted.body.game.hand).toHaveLength(7);

    // Same trick the poker timeout test uses: expire the turn in the DB and
    // let the next poll drive the engine.
    const before = await snapshot(tokenB);
    expect(before.game.turnUserId).toBe(idB);
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `UPDATE tables SET state = state || '{"turnDeadline":0}'::jsonb WHERE id = $1`,
      [tableId],
    );

    const after = await get(`/tables/${tableId}`, tokenA).expect(200);
    const afterGame = after.body.game;
    expect(afterGame.phase).toBe('playing');
    // The stalled player either played or drew: the table moved on.
    const moved =
      afterGame.turnUserId !== before.game.turnUserId ||
      afterGame.discardTop !== before.game.discardTop ||
      afterGame.drawCount !== before.game.drawCount;
    expect(moved).toBe(true);
    expect(['R', 'Y', 'G', 'B']).toContain(afterGame.activeColor);
  }, 15_000);

  it('deletes the table when the last player leaves', async () => {
    await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    await get(`/tables/${tableId}`, tokenA).expect(404);
  }, 15_000);
});
