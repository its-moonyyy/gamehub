import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/** Other players' phone numbers must never leave the friends API. */
describe('Friend phone privacy (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49181${suffix}`;
  const phoneB = `+49182${suffix}`;

  const get = (path: string, token: string) =>
    request(app.getHttpServer())
      .get(`/api${path}`)
      .set('Authorization', `Bearer ${token}`);

  const post = (path: string, token: string, body: Record<string, unknown>) => {
    const agent = request(app.getHttpServer()).post(`/api${path}`);
    if (token) agent.set('Authorization', `Bearer ${token}`);
    return agent.send(body);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const a = await post('/auth/register', '', {
      phoneNumber: phoneA,
      password: 'privacy-e2e-pass',
      displayName: 'Privacy Alpha',
    }).expect(201);
    tokenA = a.body.accessToken;
    idA = a.body.user.id;

    const b = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'privacy-e2e-pass',
      displayName: 'Privacy Beta',
    }).expect(201);
    tokenB = b.body.accessToken;
    idB = b.body.user.id;
  }, 30_000);

  afterAll(async () => {
    if (!app) return;
    await app.get(DataSource).getRepository(User).delete({ id: In([idA, idB]) });
    await app.close();
  });

  it('keeps phone numbers private before and after becoming friends', async () => {
    const ownProfile = await get('/users/me', tokenA).expect(200);
    expect(ownProfile.body.phoneNumber).toBe(phoneA);

    const search = await get(
      `/friends/search?q=${encodeURIComponent(phoneB)}`,
      tokenA,
    ).expect(200);
    expect(search.body).toContainEqual(
      expect.objectContaining({ id: idB, displayName: 'Privacy Beta' }),
    );
    expect(JSON.stringify(search.body)).not.toContain(phoneB);

    const partial = await get(
      `/friends/search?q=${suffix.slice(0, 4)}`,
      tokenA,
    ).expect(200);
    expect(partial.body).not.toContainEqual(
      expect.objectContaining({ id: idB }),
    );

    const sent = await post('/friends/requests', tokenA, { userId: idB }).expect(
      201,
    );
    expect(sent.body.outgoing).toContainEqual(
      expect.objectContaining({ userId: idB }),
    );
    expect(JSON.stringify(sent.body)).not.toContain(phoneB);

    const received = await get('/friends', tokenB).expect(200);
    expect(received.body.incoming).toContainEqual(
      expect.objectContaining({ userId: idA }),
    );
    expect(JSON.stringify(received.body)).not.toContain(phoneA);

    const requestId = received.body.incoming[0].id as number;
    const accepted = await post(
      `/friends/requests/${requestId}/accept`,
      tokenB,
      {},
    ).expect(201);
    expect(accepted.body.friends).toContainEqual(
      expect.objectContaining({ id: idA }),
    );
    expect(JSON.stringify(accepted.body)).not.toContain(phoneA);

    const friendsOfA = await get('/friends', tokenA).expect(200);
    expect(friendsOfA.body.friends).toContainEqual(
      expect.objectContaining({ id: idB }),
    );
    expect(JSON.stringify(friendsOfA.body)).not.toContain(phoneB);

    const searchAfter = await get(
      `/friends/search?q=${encodeURIComponent(phoneB)}`,
      tokenA,
    ).expect(200);
    expect(searchAfter.body).toContainEqual(
      expect.objectContaining({ id: idB, relation: 'friends' }),
    );
    expect(JSON.stringify(searchAfter.body)).not.toContain(phoneB);
  }, 20_000);
});
