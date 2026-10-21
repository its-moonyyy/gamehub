import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Full-stack Dominoes test: two real accounts create a heads-up table and play
 * a round over HTTP — ready-up, opening the chain, drawing, passing, turn
 * gating and timeout auto-play. The engine is unit-tested; here the point is
 * that Dominoes runs on the same table system as poker and Ludo.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Dominoes tables (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49220${suffix}`;
  const phoneB = `+49221${suffix}`;

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
      password: 'dominoes-e2e-pass',
      displayName: 'Domino Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'dominoes-e2e-pass',
      displayName: 'Domino Beta',
    }).expect(201);
    tokenB = registerB.body.accessToken;
    idB = registerB.body.user.id;
    await app.get(DataSource).getRepository(User).update({ id: In([idA, idB]) }, { balance: 1_000_000 });
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

  it('opens a Dominoes table and seats two players', async () => {
    const created = await post('/games/dominoes/tables', tokenA, {
      name: 'E2E Dominoes',
      entryFee: 100,
      maxSeats: 2,
      turnSeconds: 75,
    }).expect(201);
    tableId = created.body.id as number;
    expect(created.body.gameSlug).toBe('dominoes');
    expect(created.body.game.kind).toBe('dominoes');
    expect(created.body.game.phase).toBe('waiting');
    expect(created.body.game.hand).toEqual([]);
    expect(created.body.game.boneyardCount).toBe(0);
    // Dominoes tables carry no blinds.
    expect(created.body.smallBlind).toBeNull();

    const joined = await post(`/tables/${tableId}/join`, tokenB, { entryFee: 100 }).expect(201);
    expect(joined.body.seats).toHaveLength(2);
    expect(
      joined.body.seats.every((seat: { stack: number }) => seat.stack === 0),
    ).toBe(true);
  }, 15_000);

  it('refuses more seats than Dominoes has players', async () => {
    const rejected = await post('/games/dominoes/tables', tokenA, {
      name: 'Too big',
      maxSeats: 5,
    });
    expect(rejected.status).toBe(400);
  }, 15_000);

  it('deals seven hidden tiles each once both players are ready', async () => {
    const oneReady = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);
    expect(oneReady.body.game.phase).toBe('waiting');

    const started = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    const remainingMs = started.body.game.turnDeadline - started.body.game.serverNow;
    expect(remainingMs).toBeGreaterThan(74_000);
    expect(remainingMs).toBeLessThanOrEqual(75_000);
    expect(started.body.game.phase).toBe('playing');
    expect(started.body.game.gameNumber).toBe(1);
    expect(started.body.game.chain).toEqual([]);
    expect(started.body.game.boneyardCount).toBe(14);
    expect(started.body.game.hand).toHaveLength(7);
    expect(
      started.body.game.players.every(
        (player: { handCount: number }) => player.handCount === 7,
      ),
    ).toBe(true);
    // Ready flags cleared for the next round.
    expect(
      started.body.seats.every((seat: { ready: boolean }) => !seat.ready),
    ).toBe(true);

    // The opponent's hand never leaves the server — neither the tiles nor
    // what they are worth. Only the tile count is public.
    const viewA = await snapshot(tokenA);
    const viewB = await snapshot(tokenB);
    expect(viewA.game.hand).toHaveLength(7);
    expect(viewB.game.hand).toHaveLength(7);
    expect(viewA.game.hand.map((t: { id: number }) => t.id)).not.toEqual(
      viewB.game.hand.map((t: { id: number }) => t.id),
    );
    expect(
      viewA.game.players.every(
        (player: Record<string, unknown>) =>
          !('hand' in player) && !('pips' in player),
      ),
    ).toBe(true);
  }, 15_000);

  it('only lets the player on the clock act, and only Dominoes actions', async () => {
    const viewA = await snapshot(tokenA);
    const turnId = viewA.game.turnUserId as number;
    const onTurn = turnId === idA ? tokenA : tokenB;
    const offTurn = turnId === idA ? tokenB : tokenA;
    const onTurnHand =
      turnId === idA ? viewA.game.hand : (await snapshot(tokenB)).game.hand;
    const offTurnHand =
      turnId === idA ? (await snapshot(tokenB)).game.hand : viewA.game.hand;

    const offTurnMove = await post(`/tables/${tableId}/action`, offTurn, {
      type: 'play',
      tileId: onTurnHand[0].id,
    });
    expect(offTurnMove.status).toBe(400);
    expect(offTurnMove.body.message).toContain('not your turn');

    const pokerAction = await post(`/tables/${tableId}/action`, onTurn, {
      type: 'fold',
    });
    expect(pokerAction.status).toBe(400);
    expect(pokerAction.body.message).toContain('part of Dominoes');

    // A tile that is not in the acting player's hand is rejected too.
    const foreign = offTurnHand.find(
      (tile: { id: number }) =>
        !onTurnHand.some((mine: { id: number }) => mine.id === tile.id),
    );
    const wrongTile = await post(`/tables/${tableId}/action`, onTurn, {
      type: 'play',
      tileId: foreign.id,
      end: 'start',
    });
    expect(wrongTile.status).toBe(400);
  }, 15_000);

  it('plays for a player whose clock ran out', async () => {
    const before = await snapshot(tokenA);
    expect(before.game.phase).toBe('playing');

    // Same trick the poker and Ludo timeout tests use: expire the turn in the
    // DB and let the next poll drive the engine.
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `UPDATE tables SET state = state || '{"turnDeadline":0}'::jsonb WHERE id = $1`,
      [tableId],
    );

    const after = await get(`/tables/${tableId}`, tokenA).expect(200);
    const changed =
      after.body.game.chain.length > before.game.chain.length ||
      after.body.game.boneyardCount < before.game.boneyardCount ||
      after.body.game.turnUserId !== before.game.turnUserId ||
      after.body.game.phase === 'finished';
    expect(changed).toBe(true);
    if (after.body.game.phase !== 'finished') {
      expect(after.body.game.turnDeadline).toBeGreaterThan(0);
    }
  }, 15_000);

  it('plays a real round without bots: plays, draws and passes', async () => {
    let actor = tokenA;
    let actorId = idA;
    let finished = false;

    for (let action = 0; action < 400 && !finished; action += 1) {
      const view = await snapshot(actor);
      const game = view.game;
      if (game.phase !== 'playing') {
        finished = true;
        break;
      }
      if (game.turnUserId !== actorId) {
        actor = actor === tokenA ? tokenB : tokenA;
        actorId = actorId === idA ? idB : idA;
        continue;
      }

      const legal = game.legal as {
        moves: Array<{ tileId: number; end: string }>;
        draw: boolean;
        pass: boolean;
      };
      if (legal.moves.length > 0) {
        const move = legal.moves[0];
        const played = await post(`/tables/${tableId}/action`, actor, {
          type: 'play',
          tileId: move.tileId,
          end: move.end,
        });
        expect(played.status).toBe(201);
        // The played tile really left this player's hand.
        expect(
          played.body.game.hand.some(
            (tile: { id: number }) => tile.id === move.tileId,
          ),
        ).toBe(false);
      } else if (legal.draw) {
        const drawn = await post(`/tables/${tableId}/action`, actor, {
          type: 'draw',
        });
        expect(drawn.status).toBe(201);
      } else {
        const passed = await post(`/tables/${tableId}/action`, actor, {
          type: 'pass',
        });
        expect(passed.status).toBe(201);
      }
    }

    const done = await snapshot(tokenA);
    expect(done.game.phase).toBe('finished');
    expect(done.game.winnerUserIds.length).toBeGreaterThan(0);
    expect(['hand', 'blocked']).toContain(done.game.resultReason);
    expect(done.game.scores).toHaveLength(2);
    // Every tile in the chain is a real, oriented domino.
    expect(
      done.game.chain.every(
        (tile: { left: number; right: number }) =>
          tile.left >= 0 && tile.left <= 6 && tile.right >= 0 && tile.right <= 6,
      ),
    ).toBe(true);
  }, 90_000);

  it('deletes the table when the last player leaves', async () => {
    await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    await get(`/tables/${tableId}`, tokenA).expect(404);
  }, 15_000);
});
