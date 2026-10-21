import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    // Mirror main.ts so the test exercises the real routing + validation.
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  it('/api (GET) stays public for the health check', () => {
    return request(app.getHttpServer()).get('/api').expect(200, 'Hello World!');
  });

  it('serves the seeded catalog with complete game copy', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/games')
      .expect(200);
    const games = response.body as { slug: string; players: string; description: string; icon: string }[];

    expect(games.map((game) => game.slug)).toEqual([
      'poker',
      'ludo',
      'dominoes',
      'chess',
      'uno',
    ]);
    const poker = games.find((game) => game.slug === 'poker');
    // The catalog is public, so a truncated seed description would ship.
    expect(poker?.players).toBe('2–8');
    expect(poker?.description).toMatch(/Hold’em/);

    const chess = games.find((game) => game.slug === 'chess');
    expect(chess?.players).toBe('2');
    expect(chess?.description).toMatch(/mate your friend/);

    const uno = games.find((game) => game.slug === 'uno');
    expect(uno?.players).toBe('2–6');
    expect(uno?.icon).toBe('layers');
    expect(uno?.description).toMatch(/shout UNO/);
  });

  afterEach(async () => {
    await app.close();
  });
});
