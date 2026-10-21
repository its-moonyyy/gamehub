import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { User } from '../src/users/user.entity.js';

describe('Wallet requests (e2e)', () => {
  let app: INestApplication<App>;
  let playerToken: string;
  let adminToken: string;
  let playerId: number;
  const priorHash = process.env.ADMIN_PASSWORD_HASH;
  const adminPassword = 'wallet-request-admin';
  const phone = `+49185${(Date.now() % 10_000_000).toString().padStart(7, '0')}`;

  const get = (path: string, token: string) => request(app.getHttpServer())
    .get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string, body = {}) => request(app.getHttpServer())
    .post(`/api${path}`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    process.env.ADMIN_PASSWORD_HASH = hashSync(adminPassword, 4);
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const player = await post('/auth/register', '', {
      phoneNumber: phone, password: 'player-fixture-password', displayName: 'Request Tester',
    }).expect(201);
    playerToken = player.body.accessToken;
    playerId = player.body.user.id;
    adminToken = (await post('/auth/login', '', {
      phoneNumber: 'openAdmin', password: adminPassword,
    }).expect(200)).body.accessToken;
  }, 30_000);

  afterAll(async () => {
    if (app) {
      await app.get(DataSource).getRepository(User).delete({ id: playerId });
      await app.close();
    }
    if (priorHash === undefined) delete process.env.ADMIN_PASSWORD_HASH;
    else process.env.ADMIN_PASSWORD_HASH = priorHash;
  });

  it('queues, accepts, and declines without applying a request twice', async () => {
    await post('/wallet/requests', playerToken, { kind: 'deposit', amountCents: 0 }).expect(400);
    await post('/wallet/requests', playerToken, { kind: 'transfer', amountCents: 100 }).expect(400);
    await get('/admin/wallet-requests', playerToken).expect(403);
    await post('/wallet/requests', adminToken, { kind: 'deposit', amountCents: 100 }).expect(403);
    await post('/wallet/requests', playerToken, { kind: 'withdrawal', amountCents: 1 }).expect(400);

    const deposit = await post('/wallet/requests', playerToken, { kind: 'deposit', amountCents: 500 }).expect(201);
    expect(deposit.body).toMatchObject({ userId: playerId, kind: 'deposit', amountCents: 500, status: 'pending' });
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(0);
    expect((await get('/admin/wallet-requests', adminToken).expect(200)).body)
      .toContainEqual(expect.objectContaining({ id: deposit.body.id, phoneNumber: phone }));

    const [accepted, repeat] = await Promise.all([
      post(`/admin/wallet-requests/${deposit.body.id}/accept`, adminToken),
      post(`/admin/wallet-requests/${deposit.body.id}/accept`, adminToken),
    ]);
    expect([accepted.status, repeat.status].sort((a, b) => a - b)).toEqual([201, 409]);
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(500);

    const withdrawal = await post('/wallet/requests', playerToken, { kind: 'withdrawal', amountCents: 200 }).expect(201);
    await post(`/admin/wallet-requests/${withdrawal.body.id}/decline`, playerToken).expect(403);
    await post(`/admin/wallet-requests/${withdrawal.body.id}/decline`, adminToken).expect(201);
    await post(`/admin/wallet-requests/${withdrawal.body.id}/accept`, adminToken).expect(409);
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(500);

    const nextWithdrawal = await post('/wallet/requests', playerToken, { kind: 'withdrawal', amountCents: 200 }).expect(201);
    await post(`/admin/wallet-requests/${nextWithdrawal.body.id}/accept`, adminToken).expect(201);
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(300);
    const pending = await post('/wallet/requests', playerToken, { kind: 'withdrawal', amountCents: 300 }).expect(201);
    await post(`/admin/users/${playerId}/withdrawals`, adminToken, { amountCents: 100 }).expect(201);
    await post(`/admin/wallet-requests/${pending.body.id}/accept`, adminToken).expect(400);
    expect((await get('/admin/wallet-requests', adminToken).expect(200)).body)
      .toContainEqual(expect.objectContaining({ id: pending.body.id, status: 'pending' }));
    expect((await get('/auth/me', playerToken).expect(200)).body.balance).toBe(200);
    expect((await get('/wallet/requests', playerToken).expect(200)).body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: deposit.body.id, status: 'accepted' }),
      expect.objectContaining({ id: withdrawal.body.id, status: 'declined' }),
      expect.objectContaining({ id: nextWithdrawal.body.id, status: 'accepted' }),
    ]));
  }, 30_000);
});
