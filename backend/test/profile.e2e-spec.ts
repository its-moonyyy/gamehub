import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Profile + settings endpoints over HTTP: read your stats, edit your display
 * name and phone number, and change your password (old one required).
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Profile and settings (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49175${suffix}`;
  const phoneB = `+49176${suffix}`;
  const movedPhoneA = `+49177${suffix}`;

  const get = (path: string, token = '') => {
    const agent = request(app.getHttpServer()).get(`/api${path}`);
    return token ? agent.set('Authorization', `Bearer ${token}`) : agent;
  };

  const patch = (path: string, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

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

  const login = (phoneNumber: string, password: string) =>
    post('/auth/login', '', { phoneNumber, password });

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
      password: 'profile-e2e-pass',
      displayName: 'Profile Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'profile-e2e-pass',
      displayName: 'Profile Beta',
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
    const dataSource = app.get(DataSource);
    await dataSource.getRepository(User).delete({ id: In([idA, idB]) });
    await app.close();
  });

  it('keeps the profile behind a token', async () => {
    await get('/users/me').expect(401);
    await request(app.getHttpServer())
      .patch('/api/users/me')
      .send({ displayName: 'Nobody' })
      .expect(401);
  }, 15_000);

  it('finds the same account when the phone number is typed with separators', async () => {
    // Registration stores the digits; logging in with the number spaced out
    // the way people type it must reach the same account.
    const separated = `+49 175 ${suffix.slice(0, 3)} - ${suffix.slice(3, 6)} ${suffix.slice(6)}`;
    const signedIn = await login(separated, 'profile-e2e-pass').expect(200);
    expect(signedIn.body.user.id).toBe(idA);
  }, 15_000);

  it('answers 400 for table ids the database could never hold', async () => {
    await get('/tables/99999999999999999999', tokenA).expect(400);
    await get('/tables/1.5', tokenA).expect(400);
    await get('/tables/abc', tokenA).expect(400);
    await post('/tables/99999999999999999999/join', tokenA).expect(400);
    // An id that is simply not in use is still a clean 404.
    await get('/tables/99999999', tokenA).expect(404);
  }, 15_000);

  it('returns the profile with empty stats for a fresh account', async () => {
    const me = await get('/users/me', tokenA).expect(200);
    expect(me.body.id).toBe(idA);
    expect(me.body.phoneNumber).toBe(phoneA);
    expect(me.body.displayName).toBe('Profile Alpha');
    expect(me.body.balance).toBeGreaterThanOrEqual(0);
    // The hash never leaves the server.
    expect(me.body.passwordHash).toBeUndefined();
    expect(me.body.stats.tablesCreated).toBe(0);
    expect(me.body.stats.seatedTables).toEqual([]);
  }, 15_000);

  it('renames the player everywhere the name shows', async () => {
    const updated = await patch('/users/me', tokenA, {
      displayName: '  Renamed Alpha  ',
    }).expect(200);
    expect(updated.body.displayName).toBe('Renamed Alpha');

    const me = await get('/auth/me', tokenA).expect(200);
    expect(me.body.displayName).toBe('Renamed Alpha');

    const withStats = await get('/users/me', tokenA).expect(200);
    expect(withStats.body.displayName).toBe('Renamed Alpha');

    // An empty patch is a no-op, not an error.
    const unchanged = await patch('/users/me', tokenA, {}).expect(200);
    expect(unchanged.body.displayName).toBe('Renamed Alpha');
  }, 15_000);

  it('rejects names and phone numbers the app cannot use', async () => {
    await patch('/users/me', tokenA, { displayName: 'x' }).expect(400);
    await patch('/users/me', tokenA, { phoneNumber: '123' }).expect(400);
    await patch('/users/me', tokenA, { phoneNumber: 'not-a-phone' }).expect(400);
  }, 15_000);

  it('keeps phone numbers unique, but lets you save your own', async () => {
    await patch('/users/me', tokenA, { phoneNumber: phoneB }).expect(409);
    const own = await patch('/users/me', tokenA, {
      phoneNumber: ` ${phoneA} `,
    }).expect(200);
    expect(own.body.phoneNumber).toBe(phoneA);
  }, 15_000);

  it('moves the account to a new phone number', async () => {
    const moved = await patch('/users/me', tokenA, {
      phoneNumber: movedPhoneA,
    }).expect(200);
    expect(moved.body.phoneNumber).toBe(movedPhoneA);

    await login(movedPhoneA, 'profile-e2e-pass').expect(200);
    await login(phoneA, 'profile-e2e-pass').expect(401);
  }, 15_000);

  it('counts the tables you opened and the seats you hold', async () => {
    const created = await post('/games/poker/tables', tokenA, {
      name: 'E2E profile table',
      maxSeats: 2,
      smallBlind: 1,
      bigBlind: 2,
    }).expect(201);
    tableId = created.body.id as number;

    const asCreator = await get('/users/me', tokenA).expect(200);
    expect(asCreator.body.stats.tablesCreated).toBe(1);
    expect(asCreator.body.stats.seatedTables).toHaveLength(1);
    expect(asCreator.body.stats.seatedTables[0]).toMatchObject({
      id: tableId,
      name: 'E2E profile table',
      gameSlug: 'poker',
      gameName: "Texas Hold'em Poker",
      seatedCount: 1,
      maxSeats: 2,
    });

    await post(`/tables/${tableId}/join`, tokenB).expect(201);

    const twoHanded = await get('/users/me', tokenA).expect(200);
    expect(twoHanded.body.stats.seatedTables[0].seatedCount).toBe(2);
    // The joiner opened nothing but holds a seat.
    const joiner = await get('/users/me', tokenB).expect(200);
    expect(joiner.body.stats.tablesCreated).toBe(0);
    expect(joiner.body.stats.seatedTables[0].id).toBe(tableId);
  }, 20_000);

  it('changes the password only with the current one', async () => {
    await post('/auth/password', tokenA, {
      currentPassword: 'wrong-password',
      newPassword: 'brand-new-pass',
    }).expect(401);
    await post('/auth/password', tokenA, {
      currentPassword: 'profile-e2e-pass',
      newPassword: 'short',
    }).expect(400);
    await post('/auth/password', tokenA, {
      currentPassword: 'profile-e2e-pass',
      newPassword: 'profile-e2e-pass',
    }).expect(400);

    await post('/auth/password', tokenA, {
      currentPassword: 'profile-e2e-pass',
      newPassword: 'brand-new-pass',
    }).expect(204);

    await login(movedPhoneA, 'profile-e2e-pass').expect(401);
    await login(movedPhoneA, 'brand-new-pass').expect(200);

    // The token from before the change still works (stateless JWT).
    await get('/users/me', tokenA).expect(200);

    // Put it back so the cleanup assertion below stays simple.
    await post('/auth/password', tokenA, {
      currentPassword: 'brand-new-pass',
      newPassword: 'profile-e2e-pass',
    }).expect(204);
  }, 20_000);

  it('frees the seat when an account is deleted', async () => {
    // Beta is still seated; deleting the account cascades the seat away.
    const before = await get(`/tables/${tableId}`, tokenA).expect(200);
    expect(before.body.seats).toHaveLength(2);

    const dataSource = app.get(DataSource);
    await dataSource.getRepository(User).delete({ id: In([idB]) });
    idB = 0;

    const after = await get(`/tables/${tableId}`, tokenA).expect(200);
    expect(after.body.seats).toHaveLength(1);
    expect(after.body.seats[0].userId).toBe(idA);
  }, 15_000);
});
