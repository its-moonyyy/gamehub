import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource, In } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { createChessState, importChessFen } from './../src/chess/chess-engine.js';
import { User } from './../src/users/user.entity.js';

/**
 * Full-stack Chess test: two real accounts raise a table and play over HTTP —
 * ready-up, real moves, checkmate, promotion, flag fall and resignation. The
 * board itself is unit-tested; here the point is that Chess runs on the same
 * table system as poker, with the server as the only authority on the rules.
 *
 * Requires the PostgreSQL container to be running (`npm run db:up`).
 */
describe('Chess tables (e2e)', () => {
  let app: INestApplication<App>;
  let tokenA = '';
  let tokenB = '';
  let idA = 0;
  let idB = 0;
  let tableId = 0;

  const suffix = (Date.now() % 10_000_000).toString().padStart(7, '0');
  // Kept clear of the other suites' prefixes: vitest loads test files in
  // parallel, so two specs can compute the same millisecond suffix.
  const phoneA = `+49178${suffix}`;
  const phoneB = `+49179${suffix}`;

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

  const snapshot = async (token: string) =>
    (await get(`/tables/${tableId}`, token).expect(200)).body;

  /** The colours the two accounts hold in the running game. */
  const colours = async (token: string) => {
    const view = await snapshot(token);
    const players = view.game.players as Array<{
      userId: number;
      color: string;
    }>;
    const white = players.find((player) => player.color === 'w');
    const black = players.find((player) => player.color === 'b');
    return {
      view,
      whiteId: white?.userId ?? null,
      blackId: black?.userId ?? null,
      tokenOf: (userId: number | null) =>
        userId === idA ? tokenA : userId === idB ? tokenB : '',
    };
  };

  /** Plays one move for the player to move, via the real HTTP action. */
  const move = async (
    token: string,
    from: string,
    to: string,
    promotion?: string,
  ) => {
    const body: Record<string, unknown> = { type: 'move', from, to };
    if (promotion) {
      body.promotion = promotion;
    }
    const response = await post(`/tables/${tableId}/action`, token, body);
    expect(response.status).toBe(201);
    return response.body;
  };

  const readyBoth = async () => {
    // Ready order does not matter; the engine kicks off when both are in.
    await post(`/tables/${tableId}/action`, tokenA, { type: 'ready' }).expect(
      201,
    );
    const started = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    expect(started.body.game.phase).toBe('playing');
    return started.body;
  };

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
      password: 'chess-e2e-pass',
      displayName: 'Chess Alpha',
    }).expect(201);
    tokenA = registerA.body.accessToken;
    idA = registerA.body.user.id;

    const registerB = await post('/auth/register', '', {
      phoneNumber: phoneB,
      password: 'chess-e2e-pass',
      displayName: 'Chess Beta',
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

  it('opens a Chess table and seats two players', async () => {
    const created = await post('/games/chess/tables', tokenA, {
      name: 'E2E chess duel',
      maxSeats: 2,
    }).expect(201);
    tableId = created.body.id as number;
    expect(created.body.gameSlug).toBe('chess');
    expect(created.body.game.kind).toBe('chess');
    expect(created.body.game.phase).toBe('waiting');
    expect(created.body.game.players).toEqual([]);
    // Chess tables carry no blinds and no chips.
    expect(created.body.smallBlind).toBeNull();
    // The table opens with its clock and both banks ready to run.
    expect(created.body.game.timeControl).toEqual({
      id: '3+2',
      initialMs: 180_000,
      incrementMs: 2_000,
    });
    expect(created.body.game.clocks).toEqual({ w: 180_000, b: 180_000 });
    expect(created.body.game.drawOffer).toBeNull();

    // Even before a game starts the board is set up for the players to see.
    const board = created.body.game.board as unknown[];
    expect(board).toHaveLength(64);
    expect(board.filter(Boolean)).toHaveLength(32);

    const joined = await post(`/tables/${tableId}/join`, tokenB).expect(201);
    expect(joined.body.seats).toHaveLength(2);
    expect(
      joined.body.seats.every((seat: { stack: number }) => seat.stack === 0),
    ).toBe(true);
  }, 15_000);

  it('refuses a third seat at a chess board', async () => {
    const rejected = await post('/games/chess/tables', tokenA, {
      name: 'Too many',
      maxSeats: 3,
    });
    expect(rejected.status).toBe(400);
  }, 15_000);

  it('starts once both players are ready, with white to move', async () => {
    const oneReady = await post(`/tables/${tableId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);
    expect(oneReady.body.game.phase).toBe('waiting');
    expect(
      oneReady.body.seats.find((seat: { userId: number }) => seat.userId === idA)
        .ready,
    ).toBe(true);

    const started = await post(`/tables/${tableId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    expect(started.body.game.phase).toBe('playing');
    expect(started.body.game.gameNumber).toBe(1);
    expect(started.body.game.turn).toBe('w');
    expect(started.body.game.inCheck).toBe(false);
    expect(started.body.game.result).toBeNull();
    // The first game hands the white pieces to the creator's seat.
    const players = started.body.game.players as Array<{
      userId: number;
      seatIndex: number;
      color: string;
    }>;
    expect(players).toHaveLength(2);
    expect(new Set(players.map((player) => player.color))).toEqual(
      new Set(['w', 'b']),
    );
    expect(players.find((player) => player.color === 'w')?.seatIndex).toBe(0);
    expect(started.body.game.turnUserId).toBe(
      players.find((player) => player.color === 'w')?.userId,
    );
    expect(new Set(players.map((player) => player.userId))).toEqual(
      new Set([idA, idB]),
    );
    // Ready flags cleared for the next game.
    expect(
      started.body.seats.every((seat: { ready: boolean }) => !seat.ready),
    ).toBe(true);
  }, 15_000);

  it('only lets the player on the clock move, and only Chess actions', async () => {
    const { whiteId, blackId, tokenOf } = await colours(tokenA);

    const tooEarly = await post(`/tables/${tableId}/action`, tokenOf(blackId), {
      type: 'move',
      from: 'e7',
      to: 'e5',
    });
    expect(tooEarly.status).toBe(400);
    expect(tooEarly.body.message).toContain('not your turn');

    const pokerAction = await post(`/tables/${tableId}/action`, tokenOf(whiteId), {
      type: 'fold',
    });
    expect(pokerAction.status).toBe(400);
    expect(pokerAction.body.message).toContain('part of Chess');

    const missingSquares = await post(
      `/tables/${tableId}/action`,
      tokenOf(whiteId),
      { type: 'move' },
    );
    expect(missingSquares.status).toBe(400);

    const nonsense = await post(`/tables/${tableId}/action`, tokenOf(whiteId), {
      type: 'move',
      from: 'e2',
      to: 'zz',
    });
    expect(nonsense.status).toBe(400);

    const illegal = await post(`/tables/${tableId}/action`, tokenOf(whiteId), {
      type: 'move',
      from: 'e2',
      to: 'e5',
    });
    expect(illegal.status).toBe(400);
    expect(illegal.body.message).toContain('not allowed');

    // The viewer's own legal moves are listed, and nothing happens till they are played.
    const { view } = await colours(tokenOf(whiteId));
    expect(view.game.legal.moves).toHaveLength(20);
    expect(view.game.legal.resign).toBe(true);
    const waiting = await colours(tokenOf(blackId));
    expect(waiting.view.game.legal).toBeNull();
  }, 15_000);

  it("mates a careless king through the real move API", async () => {
    const { whiteId, blackId, tokenOf } = await colours(tokenA);
    const white = tokenOf(whiteId);
    const black = tokenOf(blackId);

    // Scholar's mate — the shortest real finish in chess.
    await move(white, 'e2', 'e4');
    const afterWhite = await snapshot(black);
    expect(afterWhite.game.turn).toBe('b');
    expect(afterWhite.game.lastMove).toEqual({ from: 'e2', to: 'e4' });
    expect(afterWhite.game.moves).toHaveLength(1);
    expect(afterWhite.game.moves[0]).toMatchObject({
      from: 'e2',
      to: 'e4',
      color: 'w',
      piece: 'p',
      captured: null,
    });
    // The clock flipped to the other player.
    expect(afterWhite.game.turnUserId).toBe(blackId);
    expect(afterWhite.game.turnDeadline).toBeGreaterThan(Date.now());

    await move(black, 'e7', 'e5');
    await move(white, 'f1', 'c4');
    await move(black, 'b8', 'c6');
    await move(white, 'd1', 'h5');
    await move(black, 'g8', 'f6');

    const mate = await move(white, 'h5', 'f7');
    expect(mate.game.phase).toBe('finished');
    expect(mate.game.result).toMatchObject({
      winnerUserId: whiteId,
      draw: false,
      reason: 'checkmate',
    });
    expect(mate.game.winnerUserId).toBe(whiteId);
    expect(mate.game.inCheck).toBe(true);
    expect(mate.game.legal).toBeNull();
    expect(mate.game.moves).toHaveLength(7);
    expect(mate.game.moves.at(-1)).toMatchObject({
      from: 'h5',
      to: 'f7',
      color: 'w',
      piece: 'q',
      captured: 'p',
      check: true,
      checkmate: true,
    });
    // Nothing more can be played once the game is over.
    const after = await post(`/tables/${tableId}/action`, black, {
      type: 'move',
      from: 'e8',
      to: 'f7',
    });
    expect(after.status).toBe(400);
  }, 30_000);

  it('castles: king and rook step over together and the log reads O-O', async () => {
    // A fresh game — the previous one ended in mate.
    await readyBoth();
    const { whiteId, blackId, tokenOf } = await colours(tokenA);
    const white = tokenOf(whiteId);
    const black = tokenOf(blackId);

    // 1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 — White may now castle.
    for (const [from, to] of [
      ['e2', 'e4'],
      ['e7', 'e5'],
      ['g1', 'f3'],
      ['b8', 'c6'],
      ['f1', 'c4'],
      ['f8', 'c5'],
    ]) {
      const turn = await snapshot(tokenA);
      const token = turn.game.turnUserId === idA ? tokenA : tokenB;
      await move(token, from, to);
    }

    // The server lists the castle as a legal move and says it is one.
    const before = await snapshot(white);
    const legal = before.game.legal.moves as Array<{
      from: string;
      to: string;
      castle: string | null;
    }>;
    expect(
      legal
        .filter((entry) => entry.castle)
        .map((entry) => `${entry.from}${entry.to}:${entry.castle}`),
    ).toEqual(['e1g1:k']);

    const castled = await move(white, 'e1', 'g1');
    const board = castled.game.board as Array<{
      type: string;
      color: string;
    } | null>;
    expect(board[60]).toBeNull(); // e1 — the king left
    expect(board[61]).toEqual({ type: 'r', color: 'w' }); // f1 — the rook
    expect(board[62]).toEqual({ type: 'k', color: 'w' }); // g1 — the king
    expect(board[63]).toBeNull(); // h1 — the rook left
    expect(castled.game.moves.at(-1)).toMatchObject({
      from: 'e1',
      to: 'g1',
      san: 'O-O',
    });
    // The king moved, so White has no castling left.
    expect(castled.game.castling).toMatchObject({ wK: false, wQ: false });

    // Hand the game back: the next test starts a fresh one.
    await post(`/tables/${tableId}/action`, black, { type: 'resign' }).expect(201);
  }, 30_000);

  it('promotes a pawn to the piece the player picked', async () => {
    const started = await readyBoth();
    // Game two swaps the colours so nobody is always white.
    const players = started.game.players as Array<{
      userId: number;
      color: string;
    }>;
    const whiteId =
      players.find((player) => player.color === 'w')?.userId ?? null;
    const white = whiteId === idA ? tokenA : tokenB;

    // Cheat a pawn onto the seventh rank through the DB, the same way the
    // poker tests expire a clock — then promote through the real API.
    const staged = createChessState();
    importChessFen(staged, '8/P7/8/8/8/8/8/K6k w - - 0 1');
    const dataSource = app.get(DataSource);
    await dataSource.query(
      `UPDATE tables
         SET state = state || $2::jsonb
       WHERE id = $1`,
      [
        tableId,
        JSON.stringify({
          phase: 'playing',
          turn: 'w',
          turnUserId: whiteId,
          turnDeadline: Date.now() + 180_000,
          board: staged.board,
          castling: staged.castling,
          enPassant: staged.enPassant,
          halfmoveClock: staged.halfmoveClock,
          fullmoveNumber: staged.fullmoveNumber,
          moves: [],
          lastResult: null,
        }),
      ],
    );

    // The promotion piece in the action survives the DTO's whitelist.
    const promoted = await move(white, 'a7', 'a8', 'r');
    const square = (promoted.game.board as Array<{
      type: string;
      color: string;
    } | null>)[0];
    expect(square).toEqual({ type: 'r', color: 'w' });
    expect(promoted.game.turn).toBe('b');
    expect(promoted.game.moves.at(-1)).toMatchObject({
      from: 'a7',
      to: 'a8',
      promotion: 'r',
    });
    // No castling rights were left to copy from that board.
    expect(promoted.game.castling).toEqual({
      wK: false,
      wQ: false,
      bK: false,
      bQ: false,
    });
  }, 30_000);

  it('lets a player resign the game', async () => {
    const { whiteId, blackId, tokenOf } = await colours(tokenA);
    const resigned = await post(
      `/tables/${tableId}/action`,
      tokenOf(blackId),
      { type: 'resign' },
    ).expect(201);

    expect(resigned.body.game.phase).toBe('finished');
    expect(resigned.body.game.result).toMatchObject({
      winnerUserId: whiteId,
      draw: false,
      reason: 'resignation',
    });
    expect(resigned.body.game.legal).toBeNull();
  }, 15_000);

  it('handles a draw offer: a decline first, then agreement', async () => {
    await readyBoth();
    const { whiteId, blackId, tokenOf } = await colours(tokenA);
    const white = tokenOf(whiteId);
    const black = tokenOf(blackId);

    const offered = await post(`/tables/${tableId}/action`, white, {
      type: 'offer_draw',
    }).expect(201);
    expect(offered.body.game.drawOffer).toEqual({
      userId: whiteId,
      color: 'w',
    });

    const declined = await post(`/tables/${tableId}/action`, black, {
      type: 'decline_draw',
    }).expect(201);
    expect(declined.body.game.drawOffer).toBeNull();
    expect(declined.body.game.phase).toBe('playing');

    await post(`/tables/${tableId}/action`, white, {
      type: 'offer_draw',
    }).expect(201);
    const agreed = await post(`/tables/${tableId}/action`, black, {
      type: 'accept_draw',
    }).expect(201);
    expect(agreed.body.game.phase).toBe('finished');
    expect(agreed.body.game.result).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'agreement',
    });
    expect(agreed.body.game.drawOffer).toBeNull();
  }, 30_000);

  it('creates a table with the chosen clock and charges each bank on its own', async () => {
    const created = await post('/games/chess/tables', tokenA, {
      name: 'E2E bullet',
      maxSeats: 2,
      timeControl: '1+0',
    }).expect(201);
    const bulletId = created.body.id as number;
    expect(created.body.game.timeControl).toEqual({
      id: '1+0',
      initialMs: 60_000,
      incrementMs: 0,
    });
    expect(created.body.game.clocks).toEqual({ w: 60_000, b: 60_000 });

    // The lobby advertises the clock instead of blinds.
    const lobby = await get('/games/chess/tables', tokenA).expect(200);
    const row = (
      lobby.body as Array<{ id: number; timeControl: string | null }>
    ).find((entry) => entry.id === bulletId);
    expect(row?.timeControl).toBe('1+0');

    await post(`/tables/${bulletId}/join`, tokenB).expect(201);
    await post(`/tables/${bulletId}/action`, tokenA, {
      type: 'ready',
    }).expect(201);
    const started = await post(`/tables/${bulletId}/action`, tokenB, {
      type: 'ready',
    }).expect(201);
    const players = started.body.game.players as Array<{
      userId: number;
      color: 'w' | 'b';
    }>;
    const whiteId = players.find((player) => player.color === 'w')?.userId;
    const white = whiteId === idA ? tokenA : tokenB;

    const moved = await post(`/tables/${bulletId}/action`, white, {
      type: 'move',
      from: 'e2',
      to: 'e4',
    }).expect(201);
    const clocks = moved.body.game.clocks as Record<'w' | 'b', number>;
    const movedColor = whiteId === idA ? 'w' : 'b';
    const waitingColor = movedColor === 'w' ? 'b' : 'w';
    // The mover paid for their think time; the other bank is untouched.
    expect(clocks[movedColor]).toBeGreaterThan(0);
    expect(clocks[movedColor]).toBeLessThanOrEqual(60_000);
    expect(clocks[waitingColor]).toBe(60_000);
    expect(moved.body.game.turn).toBe(waitingColor);

    // A clock the engine does not offer is refused before a table exists.
    const rejected = await post('/games/chess/tables', tokenA, {
      name: 'No such clock',
      timeControl: '99+99',
    });
    expect(rejected.status).toBe(400);

    await post(`/tables/${bulletId}/leave`, tokenA).expect(204);
    await post(`/tables/${bulletId}/leave`, tokenB).expect(204);
  }, 30_000);

  it('awards the game to the opponent when a clock runs out', async () => {
    const started = await readyBoth();
    const players = started.game.players as Array<{
      userId: number;
      color: string;
    }>;
    const blackId =
      players.find((player) => player.color === 'b')?.userId ?? null;

    const dataSource = app.get(DataSource);
    // Same trick the poker timeout test uses: drop the mover's flag in the DB
    // and let the next poll call it.
    await dataSource.query(
      `UPDATE tables SET state = state || '{"turnDeadline":0}'::jsonb WHERE id = $1`,
      [tableId],
    );

    const flagged = await get(`/tables/${tableId}`, tokenA).expect(200);
    expect(flagged.body.game.phase).toBe('finished');
    expect(flagged.body.game.result).toMatchObject({
      winnerUserId: blackId,
      draw: false,
      reason: 'timeout',
    });
    expect(flagged.body.game.winnerUserId).toBe(blackId);
    // The flag falls on the bank that ran out, not on the other one.
    expect(flagged.body.game.clocks).toEqual({ w: 0, b: 180_000 });
    // The clock stops with the game: nobody is on the move any more.
    expect(flagged.body.game.turnUserId).toBeNull();
    expect(flagged.body.game.turnDeadline).toBeNull();
    expect(flagged.body.game.legal).toBeNull();
  }, 30_000);

  it('deletes the table when the last player leaves', async () => {
    await post(`/tables/${tableId}/leave`, tokenA).expect(204);
    await post(`/tables/${tableId}/leave`, tokenB).expect(204);
    await get(`/tables/${tableId}`, tokenA).expect(404);
  }, 15_000);
});
