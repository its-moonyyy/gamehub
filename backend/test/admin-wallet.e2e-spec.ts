import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

describe('Admin account management (e2e)', () => {
  let app: INestApplication<App>;
  let playerToken = '';
  let adminToken = '';
  let playerId = 0;
  const previousAdminHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPassword = 'test-admin-password';
  const phone = `+49184${(Date.now() % 10_000_000).toString().padStart(7, '0')}`;

  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  const post = (path: string, token: string, body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = hashSync(adminPassword, 4);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const player = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        phoneNumber: phone,
        password: 'player-fixture-password',
        displayName: 'Wallet Tester',
      })
      .expect(201);
    playerToken = player.body.accessToken;
    playerId = player.body.user.id;
  }, 30_000);

  afterAll(async () => {
    if (app) {
      await app.get(DataSource).getRepository(User).delete({ id: playerId });
      await app.close();
    }
    if (previousAdminHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = previousAdminHash;
  });

  it('authenticates the admin separately from players', async () => {
    await post('/auth/login', '', {
      phoneNumber: 'openAdmin',
      password: 'wrong-password',
    }).expect(401);
    const login = await post('/auth/login', '', {
      phoneNumber: 'openAdmin',
      password: adminPassword,
    }).expect(200);
    adminToken = login.body.accessToken;
    expect(login.body.user).toMatchObject({ role: 'admin', displayName: 'Administrator' });
    expect(login.body.user).not.toHaveProperty('passwordHash');
    expect((await get('/auth/me', adminToken).expect(200)).body.role).toBe('admin');
    await get('/admin/users', playerToken).expect(403);
    await get('/users/me', adminToken).expect(403);
  }, 15_000);

  it('only lets the admin credit a player and records the change', async () => {
    expect((await get('/admin/users', adminToken).expect(200)).body).toEqual([]);
    expect((await get('/admin/users?q=Wallet', adminToken).expect(200)).body).toEqual([]);
    expect((await get(`/admin/users?q=${encodeURIComponent(phone.slice(0, -1))}`, adminToken).expect(200)).body).toEqual([]);
    const users = await get(`/admin/users?q=${encodeURIComponent(phone.replace('+49', '+49 '))}`, adminToken).expect(200);
    expect(users.body).toContainEqual(
      expect.objectContaining({ id: playerId, phoneNumber: phone, displayName: 'Wallet Tester', balance: 0 }),
    );

    await post(`/admin/users/${playerId}/credits`, playerToken, {
      amountCents: 500,
    }).expect(403);
    await post(`/admin/users/${playerId}/credits`, adminToken, {
      amountCents: -1,
    }).expect(400);
    await post(`/admin/users/${playerId}/credits`, adminToken, {
      amountCents: 0,
    }).expect(400);

    const [first, second] = await Promise.all([
      post(`/admin/users/${playerId}/credits`, adminToken, { amountCents: 500 }),
      post(`/admin/users/${playerId}/credits`, adminToken, { amountCents: 250 }),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(750);

    const credits = await get('/admin/credits', adminToken).expect(200);
    const ownCredits = credits.body.filter((entry: { userId: number }) => entry.userId === playerId);
    expect(ownCredits.map((entry: { amountCents: number }) => entry.amountCents).sort()).toEqual([250, 500]);
    expect(ownCredits.every((entry: { phoneNumber: string }) => entry.phoneNumber === phone)).toBe(true);
  }, 15_000);

  it('withdraws only available credits and records a negative wallet entry', async () => {
    await post(`/admin/users/${playerId}/withdrawals`, playerToken, { amountCents: 100 }).expect(403);
    await post(`/admin/users/${playerId}/withdrawals`, adminToken, { amountCents: 0 }).expect(400);
    await post(`/admin/users/${playerId}/withdrawals`, adminToken, { amountCents: 751 }).expect(400);
    await post('/admin/users/999999999/withdrawals', adminToken, { amountCents: 1 }).expect(404);

    const withdrawal = await post(`/admin/users/${playerId}/withdrawals`, adminToken, {
      amountCents: 200,
    }).expect(201);
    expect(withdrawal.body).toMatchObject({
      userId: playerId,
      kind: 'admin_withdrawal',
      amountCents: -200,
      balance: 550,
    });
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(550);

    const concurrent = await Promise.all([
      post(`/admin/users/${playerId}/withdrawals`, adminToken, { amountCents: 400 }),
      post(`/admin/users/${playerId}/withdrawals`, adminToken, { amountCents: 400 }),
    ]);
    expect(concurrent.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 400]);
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(150);

    const entries = (await get('/admin/adjustments', adminToken).expect(200)).body;
    const ownEntries = entries.filter((entry: { userId: number }) => entry.userId === playerId);
    expect(ownEntries.map((entry: { amountCents: number }) => entry.amountCents).sort((a: number, b: number) => a - b))
      .toEqual([-400, -200, 250, 500]);
    const credits = (await get('/admin/credits', adminToken).expect(200)).body;
    expect(credits.every((entry: { kind: string }) => entry.kind === 'admin_credit')).toBe(true);
  }, 15_000);

  it('resets a player password without exposing it and revokes prior sessions', async () => {
    const path = `/admin/users/${playerId}/password-reset`;
    await post(path, playerToken, { newPassword: 'new-fixture-password' }).expect(403);
    await post(path, adminToken, { newPassword: 'short' }).expect(400);
    await post(path, adminToken, { newPassword: 'player-fixture-password' }).expect(400);
    await post('/admin/users/999999999/password-reset', adminToken, {
      newPassword: 'new-fixture-password',
    }).expect(404);
    await post(path, adminToken, { newPassword: 'new-fixture-password' }).expect(204);

    await get('/auth/me', playerToken).expect(401);
    await post('/auth/login', '', { phoneNumber: phone, password: 'player-fixture-password' }).expect(401);
    const login = await post('/auth/login', '', {
      phoneNumber: phone,
      password: 'new-fixture-password',
    }).expect(200);
    expect(login.body.user).toMatchObject({ id: playerId, role: 'player' });
    expect(login.body.user).not.toHaveProperty('passwordHash');
    await get('/auth/me', login.body.accessToken).expect(200);
  }, 15_000);
});
