import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Full-stack Ludo test: two real accounts create a heads-up table and race
 * over HTTP — ready-up, rolling, moving, turn gating and timeout auto-play.
 * The board itself is unit-tested; here the point is that Ludo runs on the
 * same table system as poker.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Ludo tables (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49173${suffix}`;
  const phoneB = `+49174${suffix}`;

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

  const tokensOf = (view: {
    game: { players: Array<{ userId: number; tokens: number[] }> };
  }) => view.game.players.flatMap((player) => player.tokens);

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
      password: 'ludo-e2e-pass',
      displayName: 'Ludo Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'ludo-e2e-pass',
      displayName: 'Ludo Beta',
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

  it('opens a Ludo table and seats two players', async () => {
    const created = await post('/games/ludo/tables', tokenA, {
      name: 'E2E Ludo race',
      maxSeats: 2,
    }).expect(201);
    tableId = created.body.id as number;
    expect(created.body.gameSlug).toBe('ludo');
    expect(created.body.game.kind).toBe('ludo');
    expect(created.body.game.phase).toBe('waiting');
    expect(created.body.game.players).toEqual([]);
    // Ludo tables carry no blinds.
    expect(created.body.smallBlind).toBeNull();

    const joined = await post(`/tables/${tableId}/join`, tokenB).expect(201);
    expect(joined.body.seats).toHaveLength(2);
    expect(joined.body.seats.every((seat: { stack: number }) => seat.stack === 0)).toBe(true);
  }, 15_000);

  it('refuses more seats than Ludo has corners', async () => {
    const rejected = await post('/games/ludo/tables', tokenA, {
      name: 'Too big',
      maxSeats: 5,
    });
    expect(rejected.status).toBe(400);
  }, 15_000);

  it('starts once both players are ready, with opposite corners', async () => {
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
    expect(started.body.game.phase).toBe('playing');
    expect(started.body.game.gameNumber).toBe(1);
    expect(started.body.game.dice).toBeNull();
    expect(started.body.game.turnUserId).toBe(idA);

    const players = started.body.game.players as Array<{
      userId: number;
      quadrant: number;
      tokens: number[];
      home: number;
    }>;
    expect(players.map((player) => player.quadrant)).toEqual([0, 2]);
    expect(players.flatMap((player) => player.tokens)).toHaveLength(8);
    expect(tokensOf(started.body).every((steps) => steps === -1)).toBe(true);
    // Ready flags cleared for the next game.
    expect(
      started.body.seats.every((seat: { ready: boolean }) => !seat.ready),
    ).toBe(true);
  }, 15_000);

  it('only lets the player on the clock roll, and only Ludo actions', async () => {
    const waiting = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'roll',
    });
    expect(waiting.status).toBe(400);
    expect(waiting.body.message).toContain('not your turn');

    const pokerAction = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'fold',
    });
    expect(pokerAction.status).toBe(400);
    expect(pokerAction.body.message).toContain('part of Ludo');

    const moveTooEarly = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'move',
      tokenId: 0,
    });
    expect(moveTooEarly.status).toBe(400);
  }, 15_000);

  it('plays a real race without bots: rolls, moves and captures', async () => {
    let actingToken = tokenA;
    let raced = false;

    for (let step = 0; step < 120 && !raced; step += 1) {
      const view = await snapshot(actingToken);
      if (view.game.phase !== 'playing') {
        break;
      }
      const myId = actingToken === tokenA ? idA : idB;
      if (view.game.turnUserId !== myId) {
        actingToken = actingToken === tokenA ? tokenB : tokenA;
        continue;
      }

      if (view.game.dice == null) {
        const rolled = await post(`/tables/${tableId}/action`, actingToken, {
          type: 'roll',
        }).expect(201);
        const game = rolled.body.game;
        expect(game.lastRoll).toBeGreaterThanOrEqual(1);
        expect(game.lastRoll).toBeLessThanOrEqual(6);
        if (game.dice != null) {
          // The roll is waiting for a token to be picked.
          expect(game.legal.roll).toBe(false);
          expect(game.legal.moves.length).toBeGreaterThan(0);
          expect(game.legal.moves.every((move: { capture: boolean }) => typeof move.capture === 'boolean')).toBe(true);
        } else {
          // No legal move (or three sixes): the turn moved on by itself.
          expect(game.turnUserId).not.toBe(myId);
        }
      } else {
        const move = view.game.legal.moves[0] as { tokenId: number };
        expect(move).toBeDefined();
        const moved = await post(`/tables/${tableId}/action`, actingToken, {
          type: 'move',
          tokenId: move.tokenId,
        }).expect(201);
        const game = moved.body.game;
        // Every token is somewhere between base and home.
        expect(
          tokensOf(moved.body).every((steps) => steps >= -1 && steps <= 57),
        ).toBe(true);
        if (game.phase === 'finished') {
          expect(game.winnerUserId).not.toBeNull();
          break;
        }
      }

      raced = tokensOf(await snapshot(tokenA)).some((steps) => steps >= 0);
    }

    // With random dice a six shows up in well under 120 actions.
    expect(raced).toBe(true);
  }, 60_000);

  it('plays for a player whose clock ran out', async () => {
    const dataSource = app.get(DataSource);
    const before = await snapshot(tokenA);
    expect(before.game.phase).toBe('playing');

    // Same trick the poker timeout test uses: expire the turn in the DB and
    // let the next poll drive the engine.
    await dataSource.query(
      `UPDATE tables SET state = state || '{"turnDeadline":0,"dice":null,"lastRoll":null}'::jsonb WHERE id = $1`,
      [tableId],
    );

    const after = await get(`/tables/${tableId}`, tokenA).expect(200);
    expect(after.body.game.lastRoll).not.toBeNull();
    expect(
      tokensOf(after.body).every((steps) => steps >= -1 && steps <= 57),
    ).toBe(true);
  }, 15_000);

  it('deletes the table when the last player leaves', async () => {
    await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    await get(`/tables/${tableId}`, tokenA).expect(404);
  }, 15_000);
});
