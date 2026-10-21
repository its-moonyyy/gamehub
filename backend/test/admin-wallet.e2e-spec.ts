import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

describe('Admin wallet credits (e2e)', () => {
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
});
