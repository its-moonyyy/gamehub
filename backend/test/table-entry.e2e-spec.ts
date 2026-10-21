import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';
import { WalletEntry } from './../src/wallet/wallet-entry.entity.js';

describe('Paid table entry (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  const tableIds: number[] = [];
  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');

  const post = (path: string, token: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const balance = async (token: string): Promise<number> =>
    (await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)).body.balance;

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = fixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const first = await request(app.getHttpServer()).post('/api/auth/register').send({
      phoneNumber: `+49191${suffix}`,
      password: 'table-entry-pass',
      displayName: 'Entry Alpha',
    }).expect(201);
    tokenA = first.body.accessToken;
    idA = first.body.user.id;
    const second = await request(app.getHttpServer()).post('/api/auth/register').send({
      phoneNumber: `+49192${suffix}`,
      password: 'table-entry-pass',
      displayName: 'Entry Beta',
    }).expect(201);
    tokenB = second.body.accessToken;
    idB = second.body.user.id;
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    for (const tableId of tableIds) {
      await post(`/tables/${tableId}/leave`, tokenA);
      await post(`/tables/${tableId}/leave`, tokenB);
    }
    await app.get(DataSource).getRepository(User).delete({ id: In([idA, idB]) });
    await app.close();
  });

  it('requires a creator-set price and funds before creating a table', async () => {
    await post('/games/ludo/tables', tokenA).expect(400);
    await post('/games/ludo/tables', tokenA, { entryFee: 250 }).expect(400);
    expect(await balance(tokenA)).toBe(0);
    await app.get(DataSource).getRepository(User).update({ id: In([idA, idB]) }, { balance: 1_000 });
  });

  it('charges once per seat and checks the confirmed price', async () => {
    const created = await post('/games/ludo/tables', tokenA, { entryFee: 250, maxSeats: 2 }).expect(201);
    tableIds.push(created.body.id);
    expect(created.body.entryFee).toBe(250);
    expect(await balance(tokenA)).toBe(750);
    await post(`/tables/${created.body.id}/join`, tokenB).expect(400);
    await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 100 }).expect(400);
    expect(await balance(tokenB)).toBe(1_000);
    await app.get(DataSource).getRepository(User).update({ id: idB }, { balance: 100 });
    await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 250 }).expect(400);
    expect(await balance(tokenB)).toBe(100);
    await app.get(DataSource).getRepository(User).update({ id: idB }, { balance: 1_000 });
    await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 250 }).expect(201);
    expect(await balance(tokenB)).toBe(750);
    await post(`/tables/${created.body.id}/join`, tokenB).expect(201);
    expect(await balance(tokenB)).toBe(750);
    const stakes = await app.get(DataSource).getRepository(WalletEntry).find({
      where: { userId: idB, kind: 'game_stake' },
    });
    expect(stakes.map((entry) => entry.amount)).toEqual([-250]);
  });

  it('uses the poker entry price as the stack and returns unused chips on leave', async () => {
    const created = await post('/games/poker/tables', tokenA, {
      entryFee: 500,
      maxSeats: 2,
      smallBlind: 1,
      bigBlind: 2,
    }).expect(201);
    tableIds.push(created.body.id);
    expect(created.body.seats[0].stack).toBe(500);
    expect(await balance(tokenA)).toBe(250);
    const joined = await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 500 }).expect(201);
    expect(joined.body.seats.map((seat: { stack: number }) => seat.stack)).toEqual([500, 500]);
    expect(await balance(tokenB)).toBe(250);
    await post(`/tables/${created.body.id}/leave`, tokenB).expect(204);
    expect(await balance(tokenB)).toBe(750);
    const rebought = await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 500 }).expect(201);
    expect(rebought.body.seats.find((seat: { userId: number }) => seat.userId === idB).stack).toBe(500);
    expect(await balance(tokenB)).toBe(250);
    await post(`/tables/${created.body.id}/leave`, tokenB).expect(204);
    await post(`/tables/${created.body.id}/leave`, tokenA).expect(204);
    expect(await balance(tokenA)).toBe(750);
    expect(await balance(tokenB)).toBe(750);
    const payouts = await app.get(DataSource).getRepository(WalletEntry).find({
      where: { userId: In([idA, idB]), kind: 'game_payout' },
    });
    expect(payouts.map((entry) => entry.amount).sort((a, b) => a - b)).toEqual([500, 500, 500]);
  });

  it('pays the final poker stacks after a hand, including the winner\'s chips', async () => {
    const created = await post('/games/poker/tables', tokenA, {
      entryFee: 500,
      maxSeats: 2,
      smallBlind: 1,
      bigBlind: 2,
    }).expect(201);
    tableIds.push(created.body.id);
    await post(`/tables/${created.body.id}/join`, tokenB, { entryFee: 500 }).expect(201);
    await post(`/tables/${created.body.id}/action`, tokenA, { type: 'ready' }).expect(201);
    const started = await post(`/tables/${created.body.id}/action`, tokenB, { type: 'ready' }).expect(201);
    const folder = started.body.game.turnUserId === idA ? tokenA : tokenB;
    const settled = await post(`/tables/${created.body.id}/action`, folder, { type: 'fold' }).expect(201);
    expect(settled.body.game.phase).toBe('waiting');
    const stacks = new Map<number, number>(settled.body.seats.map((seat: { userId: number; stack: number }) => [seat.userId, seat.stack]));
    expect((stacks.get(idA) ?? 0) + (stacks.get(idB) ?? 0)).toBe(1_000);
    await post(`/tables/${created.body.id}/leave`, tokenA).expect(204);
    await post(`/tables/${created.body.id}/leave`, tokenB).expect(204);
    expect(await balance(tokenA)).toBe(250 + (stacks.get(idA) ?? 0));
    expect(await balance(tokenB)).toBe(250 + (stacks.get(idB) ?? 0));
  });
});
