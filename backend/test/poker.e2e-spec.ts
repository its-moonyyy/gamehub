import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { User } from './../src/users/user.entity.js';

/**
 * Full-stack poker test: two real accounts create a heads-up table and play
 * a complete hand over HTTP (ready → blinds → streets → showdown), checking
 * card privacy, legal-action gating, chip conservation, and table cleanup.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Poker tables (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  const phoneA = `+49170${suffix}`;
  const phoneB = `+49171${suffix}`;

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

  const seatsTotal = (
    seats: Array<{ stack: number; bet: number }>,
  ): number => seats.reduce((sum, seat) => sum + seat.stack + seat.bet, 0);

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
      password: 'poker-e2e-pass',
      displayName: 'E2E Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'poker-e2e-pass',
      displayName: 'E2E Beta',
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

  it('seats both players at a fresh heads-up table', async () => {
    const created = await post('/games/poker/tables', tokenA, {
      name: 'E2E heads-up',
      maxSeats: 2,
      smallBlind: 100,
      bigBlind: 200,
    }).expect(201);
    tableId = created.body.id as number;
    expect(created.body.game.phase).toBe('waiting');

    const joined = await post(`/tables/${tableId}/join`, tokenB).expect(201);
    expect(joined.body.seats).toHaveLength(2);
    const viewA = await get(`/tables/${tableId}`, tokenA).expect(200);
    expect(
      viewA.body.seats.map((seat: { stack: number }) => seat.stack),
    ).toEqual([20_000, 20_000]);
  }, 15_000);

  it('deals once everyone is ready, posts the blinds and hides hole cards', async () => {
    const oneReady = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);
    expect(oneReady.body.game.phase).toBe('waiting');
    expect(
      oneReady.body.seats.find(
        (seat: { userId: number }) => seat.userId === idA,
      ).ready,
    ).toBe(true);

    const dealt = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    expect(dealt.body.game.phase).toBe('preflop');
    expect(dealt.body.game.handNumber).toBe(1);
    expect(dealt.body.game.pot).toBe(300);
    // One pot so far — the blinds, which everybody can still win.
    expect(dealt.body.game.pots).toEqual([
      {
        amount: 300,
        main: true,
        level: 0,
        eligibleUserIds: [idA, idB],
      },
    ]);
    // Heads-up: the button posts the small blind and acts first.
    expect(dealt.body.game.turnUserId).toBe(idA);
    // The payload names the blind seats and their bets match the blinds.
    const seatAt = (seatIndex: number | null) =>
      dealt.body.seats.find(
        (s: { seatIndex: number }) => s.seatIndex === seatIndex,
      );
    const sbSeat = dealt.body.game.smallBlindSeat as number | null;
    const bbSeat = dealt.body.game.bigBlindSeat as number | null;
    expect(sbSeat).not.toBeNull();
    expect(bbSeat).not.toBeNull();
    expect(seatAt(sbSeat).bet).toBe(100);
    expect(seatAt(bbSeat).bet).toBe(200);
    // Heads-up: the button posts the small blind, so both chips share a seat.
    expect(sbSeat).toBe(dealt.body.game.dealerSeat);
    expect(bbSeat).not.toBe(dealt.body.game.dealerSeat);

    const viewA = await get(`/tables/${tableId}`, tokenA).expect(200);
    const seatA = viewA.body.seats.find(
      (seat: { userId: number }) => seat.userId === idA,
    );
    const seatB = viewA.body.seats.find(
      (seat: { userId: number }) => seat.userId === idB,
    );
    expect(seatA.cards).toHaveLength(2);
    expect(seatB.cards).toBeNull();

    const viewB = await get(`/tables/${tableId}`, tokenB).expect(200);
    expect(
      viewB.body.seats.find((seat: { userId: number }) => seat.userId === idB)
        .cards,
    ).toHaveLength(2);
    expect(
      viewB.body.seats.find((seat: { userId: number }) => seat.userId === idA)
        .cards,
    ).toBeNull();

    // Legal actions come from the server: fold/check/call/raise/all-in.
    expect(viewA.body.game.legal.fold).toBe(true);
    expect(viewA.body.game.legal.check).toBe(false);
    expect(viewA.body.game.legal.callAmount).toBe(100);
    expect(viewA.body.game.legal.raise.min).toBe(400);
    expect(viewA.body.game.legal.raise.max).toBe(20_000);
    expect(viewA.body.game.legal.allIn).toBe(true);
  }, 15_000);

  it('rejects out-of-turn and illegal actions', async () => {
    await post(`/tables/${tableId}/action`, tokenB, {
      type: 'check',
    }).expect(400);
    // The minimum raise is 400 (a full big blind over the 200 bet): 300 must be rejected.
    await post(`/tables/${tableId}/action`, tokenA, {
      type: 'raise',
      amount: 300,
    }).expect(400);
  }, 15_000);

  it('plays through every street and settles the showdown', async () => {
    const called = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'call',
    }).expect(201);
    expect(called.body.game.pot).toBe(400);
    expect(called.body.game.turnUserId).toBe(idB); // big blind gets the option

    const afterBBOption = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'check',
    }).expect(201);
    expect(afterBBOption.body.game.phase).toBe('flop');
    expect(afterBBOption.body.game.community).toHaveLength(3);
    // First seat after the button acts first after the flop.
    expect(afterBBOption.body.game.turnUserId).toBe(idB);

    const afterFlopB = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'check',
    }).expect(201);
    expect(afterFlopB.body.game.turnUserId).toBe(idA);
    const afterFlopA = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'check',
    }).expect(201);
    expect(afterFlopA.body.game.phase).toBe('turn');
    expect(afterFlopA.body.game.community).toHaveLength(4);

    const afterTurnB = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'check',
    }).expect(201);
    expect(afterTurnB.body.game.turnUserId).toBe(idA);
    const afterTurnA = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'check',
    }).expect(201);
    expect(afterTurnA.body.game.phase).toBe('river');
    expect(afterTurnA.body.game.community).toHaveLength(5);

    const afterRiverB = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'check',
    }).expect(201);
    expect(afterRiverB.body.game.turnUserId).toBe(idA);
    const showdown = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'check',
    }).expect(201);

    expect(showdown.body.game.phase).toBe('waiting');
    expect(showdown.body.game.pot).toBe(0);
    const winners = showdown.body.game.winners as Array<{
      userId: number;
      amount: number;
      hand: string | null;
    }>;
    expect(winners.length).toBeGreaterThanOrEqual(1);
    expect(winners.reduce((sum, winner) => sum + winner.amount, 0)).toBe(400);
    expect(winners.every((winner) => winner.hand != null)).toBe(true);
    // The hand is remembered pot by pot: one main pot, no side pot.
    expect(showdown.body.game.potAwards).toEqual([
      {
        amount: 400,
        main: true,
        winners: [
          {
            userId: winners[0].userId,
            amount: 400,
            hand: winners[0].hand,
          },
        ],
      },
    ]);

    // Both hands are face-up at showdown and chips are conserved: each
    // player committed the big blind, so the winner nets exactly 200.
    expect(
      showdown.body.seats.every(
        (seat: { cards: string[] | null }) => seat.cards?.length === 2,
      ),
    ).toBe(true);
    const stacks = showdown.body.seats
      .map((seat: { stack: number }) => seat.stack)
      .sort((a: number, b: number) => a - b);
    expect(stacks).toEqual([19_800, 20_200]);
    expect(seatsTotal(showdown.body.seats)).toBe(40_000);
    // Ready flags reset for the next hand, and the button/blind chips stay
    // where the finished hand left them until the next one is dealt.
    expect(
      showdown.body.seats.every((seat: { ready: boolean }) => !seat.ready),
    ).toBe(true);
    expect(showdown.body.game.smallBlindSeat).not.toBeNull();
    expect(showdown.body.game.bigBlindSeat).not.toBeNull();
    expect(showdown.body.game.smallBlindSeat).toBe(
      showdown.body.game.dealerSeat,
    );
    expect(showdown.body.game.bigBlindSeat).not.toBe(
      showdown.body.game.dealerSeat,
    );
  }, 15_000);

  it('deletes an empty table when the last player leaves', async () => {
    await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    await get(`/tables/${tableId}`, tokenA).expect(404);
  }, 15_000);
});
