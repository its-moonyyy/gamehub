import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Seat status over HTTP: every seat carries a presence dot — green online,
 * red offline, amber while a waiting game is stuck on that player. Presence
 * comes from the request heartbeat, so this test drives it with real calls
 * and one deliberate silence.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Seat presence (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49224${suffix}`;
  const phoneB = `+49225${suffix}`;

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

  /** The seat of a player as seen by `token`. */
  const seatOf = async (token: string, userId: number) => {
    const view = await get(`/tables/${tableId}`, token).expect(200);
    const seat = (
      view.body.seats as Array<{ userId: number; status: string }>
    ).find((s) => s.userId === userId);
    expect(seat).toBeDefined();
    return seat!;
  };

  const goQuiet = (userId: number) =>
    app
      .get(DataSource)
      .getRepository(User)
      .update(
        { id: userId },
        { lastSeenAt: new Date(Date.now() - 10 * 60_000) },
      );

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
      password: 'presence-e2e-pass',
      displayName: 'Presence Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'presence-e2e-pass',
      displayName: 'Presence Beta',
    }).expect(201);
    tokenB = registerB.body.accessToken;
    idB = registerB.body.user.id;
    await app.get(DataSource).getRepository(User).update({ id: In([idA, idB]) }, { balance: 1_000_000 });

    const created = await post('/games/poker/tables', tokenA, {
      name: 'E2E presence table',
      entryFee: 20_000,
      maxSeats: 2,
      smallBlind: 1,
      bigBlind: 2,
    }).expect(201);
    tableId = created.body.id as number;

    await post(`/tables/${tableId}/join`, tokenB, { entryFee: 20_000 }).expect(201);
  }, 30_000);

  afterAll(async () => {
    for (const token of [tokenA, tokenB]) {
      try {
        await post(`/tables/${tableId}/leave`, token).expect(204);
      } catch {
        /* the table may already be gone */
      }
    }
    const dataSource = app.get(DataSource);
    await dataSource.getRepository(User).delete({ id: In([idA, idB]) });
    await app.close();
  });

  it('dots both seated players amber while nobody has readied', async () => {
    const seenByA = await get(`/tables/${tableId}`, tokenA).expect(200);
    for (const seat of seenByA.body.seats as Array<{ status: string }>) {
      expect(seat.status).toBe('not-ready');
    }

    // Beta's own view agrees, and never calls itself offline.
    const seenByB = await seatOf(tokenB, idB);
    expect(seenByB.status).toBe('not-ready');
  }, 15_000);

  it('turns a player green as soon as they are ready', async () => {
    await post(`/tables/${tableId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);

    expect((await seatOf(tokenA, idA)).status).toBe('online');
    expect((await seatOf(tokenA, idB)).status).toBe('not-ready');
  }, 15_000);

  it('greens everyone once the hand is running', async () => {
    const started = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    expect(started.body.game.phase).toBe('preflop');

    expect((await seatOf(tokenA, idA)).status).toBe('online');
    expect((await seatOf(tokenA, idB)).status).toBe('online');
  }, 15_000);

  it('drops a quiet player to red, and lifts them back on their next call', async () => {
    await goQuiet(idB);

    expect((await seatOf(tokenA, idB)).status).toBe('offline');
    // Alpha keeps talking, so Alpha stays green.
    expect((await seatOf(tokenA, idA)).status).toBe('online');

    // Beta signs back in — the heartbeat puts the dot back to green.
    await post('/auth/login', '', {
      phoneNumber: phoneB,
      password: 'presence-e2e-pass',
    }).expect(200);

    expect((await seatOf(tokenA, idB)).status).toBe('online');
  }, 20_000);
});
