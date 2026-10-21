import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

describe('Automatic table names (e2e)', () => {
  let app: INestApplication<App>;
  let token = '';
  let userId = 0;
  const tableIds: number[] = [];
  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phone = `+49183${suffix}`;

  const post = (path: string, body: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post(`/api${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const registered = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({
        phoneNumber: phone,
        password: 'table-naming-pass',
        displayName: 'User Name',
      })
      .expect(201);
    token = registered.body.accessToken;
    userId = registered.body.user.id;
    await app.get(DataSource).getRepository(User).update({ id: userId }, { balance: 1_000_000 });
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    for (const tableId of tableIds) {
      await post(`/tables/${tableId}/leave`).expect(204);
    }
    await app.get(DataSource).getRepository(User).delete({ id: userId });
    await app.close();
  });

  it('uses a game prefix, current username, and a distinct eight-character code', async () => {
    const expectedPrefixes: Record<string, string> = {
      poker: 'poker',
      chess: 'echec',
      ludo: 'ludo',
      dominoes: 'dominoes',
      uno: 'uno',
    };
    const names: string[] = [];

    for (const [slug, prefix] of Object.entries(expectedPrefixes)) {
      const created = await post(`/games/${slug}/tables`, {
        name: 'Client supplied name must be ignored',
        entryFee: slug === 'poker' ? 20_000 : 100,
      }).expect(201);
      tableIds.push(created.body.id);
      names.push(created.body.name);
      expect(created.body.name).toMatch(
        new RegExp(`^${prefix}-user_name-[A-Za-z0-9_-]{8}$`),
      );
      expect(created.body.name.length).toBeLessThanOrEqual(40);
    }

    const secondPoker = await post('/games/poker/tables', { entryFee: 20_000 }).expect(201);
    tableIds.push(secondPoker.body.id);
    names.push(secondPoker.body.name);
    expect(secondPoker.body.name).toMatch(/^poker-user_name-[A-Za-z0-9_-]{8}$/);
    expect(new Set(names).size).toBe(names.length);
  }, 30_000);

  it('keeps long display names within the table name limit', async () => {
    const updated = await request(app.getHttpServer())
      .patch('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        displayName: 'A Very Long Display Name With More Than Forty Characters',
      })
      .expect(200);
    expect(updated.body.displayName.length).toBeGreaterThan(40);

    const created = await post('/games/poker/tables', { entryFee: 20_000 }).expect(201);
    tableIds.push(created.body.id);
    expect(created.body.name).toMatch(
      /^poker-a_very_long_display_name-[A-Za-z0-9_-]{8}$/,
    );
    expect(created.body.name.length).toBeLessThanOrEqual(40);
  }, 15_000);

  it('keeps the chosen turn timer on every non-chess table', async () => {
    for (const slug of ['poker', 'ludo', 'dominoes', 'uno']) {
      const created = await post(`/games/${slug}/tables`, {
        turnSeconds: 75,
        entryFee: slug === 'poker' ? 20_000 : 100,
      }).expect(201);
      tableIds.push(created.body.id);

      const lobby = await request(app.getHttpServer())
        .get(`/api/games/${slug}/tables`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const table = lobby.body.find(
        (row: { id: number }) => row.id === created.body.id,
      );
      expect(table?.turnSeconds).toBe(75);
    }

    await post('/games/chess/tables', { turnSeconds: 75 }).expect(400);
  }, 30_000);
});
