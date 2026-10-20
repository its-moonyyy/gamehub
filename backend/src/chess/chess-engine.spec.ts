import { describe, expect, it } from 'vitest';
import {
  ChessError,
  createChessState,
  everyoneChessReady,
  exportChessFen,
  generateLegalMoves,
  hasInsufficientMaterial,
  importChessFen,
  initialChessBoard,
  isInCheck,
  legalChessActions,
  leaveChess,
  markChessReady,
  playChessMove,
  repetitionKey,
  resignChess,
  startChess,
  tickChess,
  hasMatingMaterial,
  normalizeChessState,
  offerChessDraw,
  acceptChessDraw,
  declineChessDraw,
  findChessTimeControl,
  type ChessColor,
  type ChessState,
  type ChessPromotion,
} from './chess-engine.js';

const TURN_MS = 180_000;

function seats(...userIds: number[]) {
  return userIds.map((userId, seatIndex) => ({ userId, seatIndex }));
}

function game(now = 1_000, timeControl = '3+2'): ChessState {
  const state = createChessState();
  startChess(state, { seats: seats(1, 2), timeControl, now });
  return state;
}

/** Starts a game, then drops the given FEN in and puts the mover on the clock. */
function setup(fen: string): ChessState {
  const state = game();
  importChessFen(state, fen);
  const mover = state.players.find((player) => player.color === state.turn);
  state.turnUserId = mover?.userId ?? null;
  return state;
}

function playerOf(state: ChessState, color: ChessColor) {
  const player = state.players.find((candidate) => candidate.color === color);
  if (!player) {
    throw new Error(`no ${color} player`);
  }
  return player;
}

function play(
  state: ChessState,
  userId: number,
  from: string,
  to: string,
  promotion: ChessPromotion | null = null,
  now = 2_000,
): void {
  playChessMove(state, userId, from, to, promotion, now);
}

describe('startChess', () => {
  it('seats exactly two players and gives the first seat white', () => {
    const state = game();
    expect(state.phase).toBe('playing');
    expect(state.turn).toBe('w');
    expect(state.turnUserId).toBe(1);
    expect(state.turnDeadline).toBe(1_000 + TURN_MS);
    expect(playerOf(state, 'w').userId).toBe(1);
    expect(playerOf(state, 'b').userId).toBe(2);
    expect(state.moves).toEqual([]);
    expect(state.fullmoveNumber).toBe(1);
  });

  it('starts from the standard position', () => {
    const state = game();
    const board = initialChessBoard();
    expect(state.board).toEqual(board);
    expect(board[60]).toEqual({ type: 'k', color: 'w' });
    expect(board[4]).toEqual({ type: 'k', color: 'b' });
    expect(board[52]).toEqual({ type: 'p', color: 'w' });
    expect(board[12]).toEqual({ type: 'p', color: 'b' });
  });

  it('swaps colours between games so nobody always moves first', () => {
    const state = game();
    resignChess(state, 2);
    startChess(state, { seats: seats(1, 2), timeControl: '3+2', now: 3_000 });
    expect(state.gameNumber).toBe(2);
    expect(playerOf(state, 'w').userId).toBe(2);
    expect(state.turnUserId).toBe(2);
  });

  it('refuses one player and more than two', () => {
    const state = createChessState();
    expect(() =>
      startChess(state, { seats: seats(1), timeControl: '3+2', now: 0 }),
    ).toThrow(ChessError);
    expect(() =>
      startChess(state, { seats: seats(1, 2, 3), timeControl: '3+2', now: 0 }),
    ).toThrow(ChessError);
  });

  it('loads both clocks from the chosen time control', () => {
    const state = game(1_000, '1+0');
    expect(state.timeControl).toBe('1+0');
    expect(state.clocks).toEqual({ w: 60_000, b: 60_000 });
    expect(state.turnStartedAt).toBe(1_000);
    expect(state.turnDeadline).toBe(1_000 + 60_000);
  });

  it('falls back to the default clock for an unknown time control', () => {
    const control = findChessTimeControl('99+99');
    expect(control.id).toBe('3+2');
    expect(control.initialMs).toBe(TURN_MS);
    expect(control.incrementMs).toBe(2_000);
  });
});

describe('clocks and increments', () => {
  it('charges the mover for the time used and adds the increment', () => {
    const state = game(1_000, '3+2');
    // White thinks for ten seconds, then plays e4.
    play(state, 1, 'e2', 'e4', null, 11_000);
    expect(state.clocks.w).toBe(TURN_MS - 10_000 + 2_000);
    expect(state.clocks.b).toBe(TURN_MS);
    // Black's deadline comes from black's own bank, not a fixed per-move slot.
    expect(state.turnStartedAt).toBe(11_000);
    expect(state.turnDeadline).toBe(11_000 + state.clocks.b);
  });

  it('keeps a separate bank per player', () => {
    const state = game(0, '5+0');
    play(state, 1, 'e2', 'e4', null, 4_000);
    play(state, 2, 'e7', 'e5', null, 14_000);
    expect(state.clocks.w).toBe(296_000);
    expect(state.clocks.b).toBe(290_000);
    // White's next move runs on what white has left.
    expect(state.turnDeadline).toBe(14_000 + 296_000);
  });

  it('refuses a move that arrives after the flag fell', () => {
    const state = game(0, '1+0');
    expect(() => play(state, 1, 'e2', 'e4', null, 60_000)).toThrow(
      'clock ran out',
    );
    // The move is not played, and the bank is untouched.
    expect(state.board[52]).toEqual({ type: 'p', color: 'w' });
    expect(state.clocks.w).toBe(60_000);
  });
});

describe('moving', () => {
  it('plays a pawn two squares and passes the turn', () => {
    const state = game();
    play(state, 1, 'e2', 'e4');
    expect(state.board[52]).toBeNull();
    expect(state.board[36]).toEqual({ type: 'p', color: 'w' });
    expect(state.moves.at(-1)?.san).toBe('e4');
    expect(state.turn).toBe('b');
    expect(state.turnUserId).toBe(2);
    expect(state.turnDeadline).toBe(2_000 + TURN_MS);
    expect(state.halfmoveClock).toBe(0);
  });

  it('refuses illegal moves and moves out of turn', () => {
    const state = game();
    expect(() => play(state, 1, 'e2', 'e5')).toThrow('not allowed');
    expect(() => play(state, 1, 'e2', 'e3', null, 2_000)).not.toThrow();
    // It is black's turn now, and white may not move again.
    expect(() => play(state, 1, 'd2', 'd4')).toThrow('not your turn');
    expect(() => play(state, 2, 'e7', 'e5')).not.toThrow();
  });

  it('never allows a pinned piece to expose its king', () => {
    const state = setup('4r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
    expect(() => play(state, 1, 'e2', 'd2')).toThrow('not allowed');
    expect(() => play(state, 1, 'e2', 'e3')).not.toThrow();
  });

  it('counts full moves after black replies', () => {
    const state = game();
    play(state, 1, 'e2', 'e4');
    play(state, 2, 'e7', 'e5');
    expect(state.fullmoveNumber).toBe(2);
  });
});

describe('castling', () => {
  it('moves king and rook together, both sides', () => {
    const state = setup('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    play(state, 1, 'e1', 'g1');
    expect(state.board[62]).toEqual({ type: 'k', color: 'w' });
    expect(state.board[61]).toEqual({ type: 'r', color: 'w' });
    expect(state.board[63]).toBeNull();
    expect(state.moves.at(-1)?.san).toBe('O-O');
    expect(state.castling.wK).toBe(false);
    expect(state.castling.wQ).toBe(false);
  });

  it('refuses to castle through an attacked square', () => {
    const state = setup('5rk1/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(() => play(state, 1, 'e1', 'g1')).toThrow('not allowed');
  });

  it('refuses to castle into an attacked square', () => {
    // The black rook on g8 covers g1 — the king may not land on it.
    const state = setup('6r1/8/8/8/8/8/8/4K2R w K - 0 1');
    expect(() => play(state, 1, 'e1', 'g1')).toThrow('not allowed');
  });

  it('refuses to castle queenside into an attacked square', () => {
    // The black rook on c8 covers c1, where the king would finish.
    const state = setup('2r5/8/8/8/8/8/8/R3K3 w Q - 0 1');
    expect(() => play(state, 1, 'e1', 'c1')).toThrow('not allowed');
  });

  it('allows castling while the rook is under attack', () => {
    // FIDE 3.8.2.2: only the king's squares matter, the rook may be attacked.
    const state = setup('7r/8/8/8/8/8/8/4K2R w K - 0 1');
    play(state, 1, 'e1', 'g1');
    expect(state.board[62]).toEqual({ type: 'k', color: 'w' });
    expect(state.board[61]).toEqual({ type: 'r', color: 'w' });
  });

  it('refuses to castle when the rook is not on its home square', () => {
    const state = setup('4k3/8/8/8/8/8/8/4K3 w K - 0 1');
    expect(() => play(state, 1, 'e1', 'g1')).toThrow('not allowed');
  });

  it('loses the rights when the rook is captured', () => {
    const state = setup('4k2r/8/8/8/8/8/P7/4K2R w K - 0 1');
    play(state, 1, 'a2', 'a3');
    play(state, 2, 'h8', 'h1');
    expect(state.castling.wK).toBe(false);
  });

  it('tells the room which legal move is a castle', () => {
    const state = setup('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const moves = legalChessActions(state, 1)?.moves ?? [];
    const castles = moves
      .filter((move) => move.castle != null)
      .map((move) => `${move.from}${move.to}:${move.castle}`)
      .sort();
    expect(castles).toEqual(['e1c1:q', 'e1g1:k']);
  });

  it('loses the rights when the king or a rook moves', () => {
    const state = game();
    play(state, 1, 'e2', 'e4');
    play(state, 2, 'e7', 'e5');
    play(state, 1, 'e1', 'e2');
    expect(state.castling.wK).toBe(false);
    expect(state.castling.wQ).toBe(false);
    expect(state.castling.bK).toBe(true);
  });
});

describe('en passant and promotion', () => {
  it('captures a pawn that just ran past', () => {
    const state = setup('8/8/8/8/4p3/8/3P4/8 w - - 0 1');
    play(state, 1, 'd2', 'd4');
    expect(state.enPassant).toBe('d3');
    play(state, 2, 'e4', 'd3');
    expect(state.board[43]).toEqual({ type: 'p', color: 'b' });
    expect(state.board[35]).toBeNull();
    expect(state.moves.at(-1)?.san).toBe('exd3');
    expect(state.moves.at(-1)?.captured).toBe('p');
  });

  it('promotes to the chosen piece', () => {
    const state = setup('8/4P3/8/k7/8/8/8/4K3 w - - 0 1');
    play(state, 1, 'e7', 'e8', 'n');
    expect(state.board[4]).toEqual({ type: 'n', color: 'w' });
    expect(state.moves.at(-1)?.san).toBe('e8=N');
  });

  it('defaults to a queen when no piece is chosen', () => {
    const state = setup('8/4P3/8/k7/8/8/8/4K3 w - - 0 1');
    play(state, 1, 'e7', 'e8');
    expect(state.board[4]).toEqual({ type: 'q', color: 'w' });
    expect(state.moves.at(-1)?.san).toBe('e8=Q');
  });
});

describe('check, mate and draws', () => {
  it('detects check and keeps playing', () => {
    const state = setup('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    play(state, 1, 'a1', 'd1');
    play(state, 2, 'e8', 'e7');
    play(state, 1, 'd1', 'd7');
    expect(isInCheck(state.board, 'b')).toBe(true);
    expect(state.moves.at(-1)?.check).toBe(true);
    expect(state.moves.at(-1)?.san).toBe('Rd7+');
    expect(state.phase).toBe('playing');
  });

  it("plays scholar's mate", () => {
    const state = game();
    play(state, 1, 'e2', 'e4');
    play(state, 2, 'e7', 'e5');
    play(state, 1, 'f1', 'c4');
    play(state, 2, 'b8', 'c6');
    play(state, 1, 'd1', 'h5');
    play(state, 2, 'g8', 'f6');
    play(state, 1, 'h5', 'f7');

    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: 1,
      draw: false,
      reason: 'checkmate',
    });
    expect(state.moves.at(-1)?.san).toBe('Qxf7#');
    expect(state.moves.at(-1)?.checkmate).toBe(true);
    expect(playerOf(state, 'w').lastAction).toBe('Qxf7#');
    expect(state.turnUserId).toBeNull();
    expect(state.turnDeadline).toBeNull();
  });

  it('draws a stalemate', () => {
    const state = setup('7k/8/8/6Q1/8/8/8/6K1 w - - 0 1');
    play(state, 1, 'g5', 'g6');
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'stalemate',
    });
    expect(state.moves.at(-1)?.san).toBe('Qg6');
  });

  it('draws when only kings are left', () => {
    const state = setup('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    play(state, 1, 'a1', 'd1');
    play(state, 2, 'e8', 'e7');
    play(state, 1, 'd1', 'd7');
    play(state, 2, 'e7', 'd7');
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('insufficient-material');
    expect(state.lastResult?.draw).toBe(true);
    expect(hasInsufficientMaterial(state.board)).toBe(true);
  });

  it('draws when both bishops stand on the same colour', () => {
    // a1 and h8 are both dark squares — no mate is possible, ever.
    const state = setup('7b/4k3/8/8/8/8/8/B3K3 w - - 0 1');
    play(state, 1, 'a1', 'b2');
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('insufficient-material');
  });

  it('keeps playing when the bishops stand on different colours', () => {
    // a1 is dark, a8 is light — with help, a mate is still possible.
    const state = setup('b7/4k3/8/8/8/8/8/B3K3 w - - 0 1');
    play(state, 1, 'a1', 'b2');
    expect(state.phase).toBe('playing');
    expect(hasInsufficientMaterial(state.board)).toBe(false);
  });

  it('keeps playing knight against knight', () => {
    // Two knights can mate with the help of the defender's own pieces.
    const state = setup('k6n/8/8/8/8/8/8/N6K w - - 0 1');
    play(state, 1, 'a1', 'b3');
    expect(state.phase).toBe('playing');
    expect(hasInsufficientMaterial(state.board)).toBe(false);
  });

  it('draws two knights against a bare king', () => {
    // A bare king can never be mated by two knights.
    const state = setup('4k3/8/8/8/8/8/8/3NKN2 w - - 0 1');
    play(state, 1, 'd1', 'c3');
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.reason).toBe('insufficient-material');
  });

  it('draws on the fifty-move rule', () => {
    const state = setup('4k3/8/8/8/8/8/8/R3K3 w - - 99 80');
    play(state, 1, 'a1', 'd1');
    expect(state.halfmoveClock).toBe(100);
    expect(state.lastResult).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'fifty-move',
    });
  });

  it('draws when the same position appears three times', () => {
    const state = game();
    const shuffle = [
      [1, 'g1', 'f3'],
      [2, 'g8', 'f6'],
      [1, 'f3', 'g1'],
      [2, 'f6', 'g8'],
    ] as const;

    for (const [user, from, to] of shuffle) {
      play(state, user, from, to);
    }
    // Back at the start for the second time — the game goes on.
    expect(state.phase).toBe('playing');

    for (const [user, from, to] of shuffle) {
      play(state, user, from, to);
    }
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'threefold',
    });
  });

  it('ignores the move counters when comparing positions', () => {
    const state = game();
    const key = repetitionKey(state);
    state.halfmoveClock = 42;
    state.fullmoveNumber = 77;
    expect(repetitionKey(state)).toBe(key);
  });

  it('ignores an en passant square that no pawn can capture on', () => {
    // FIDE 9.2.2: the possible moves decide whether two positions are the
    // same. With no black pawn beside e4, nobody can capture on e3.
    const withSquare = setup('4k3/8/8/8/4P3/8/8/4K3 b - e3 0 1');
    const without = setup('4k3/8/8/8/4P3/8/8/4K3 b - - 0 1');
    expect(repetitionKey(withSquare)).toBe(repetitionKey(without));

    // With a black pawn on d4 the capture is real, so the square counts.
    const capturable = setup('4k3/8/8/3p4/4P3/8/8/4K3 b - e3 0 1');
    expect(repetitionKey(capturable)).not.toBe(repetitionKey(without));
  });
});

describe('resigning and timing out', () => {
  it('hands the win to the opponent when a player resigns', () => {
    const state = game();
    resignChess(state, 1);
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: 2,
      draw: false,
      reason: 'resignation',
    });
    expect(playerOf(state, 'w').lastAction).toBe('Resigned');
    expect(playerOf(state, 'b').lastAction).toBe('Won by resignation');
  });

  it('falls the flag when the mover runs out of time', () => {
    const state = game();
    expect(tickChess(state, 1_000 + TURN_MS - 1)).toBe(false);
    expect(tickChess(state, 1_000 + TURN_MS)).toBe(true);
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: 2,
      draw: false,
      reason: 'timeout',
    });
    expect(playerOf(state, 'w').lastAction).toBe('Ran out of time');
    expect(playerOf(state, 'b').lastAction).toBe('Won on time');
    expect(state.clocks.w).toBe(0);
  });

  it('draws instead of awarding a win when the flag falls in a dead position', () => {
    const state = setup('k7/8/8/8/8/8/8/K6B w - - 0 1');
    expect(hasMatingMaterial(state.board, 'b')).toBe(false);
    expect(tickChess(state, 1_000 + TURN_MS)).toBe(true);
    expect(state.lastResult).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'timeout',
    });
    expect(playerOf(state, 'w').lastAction).toBe('Drew on time');
    expect(playerOf(state, 'b').lastAction).toBe('Drew on time');
  });

  it('still awards the win when the opponent has mating material', () => {
    const state = setup('k6r/8/8/8/8/8/8/K7 w - - 0 1');
    expect(hasMatingMaterial(state.board, 'b')).toBe(true);
    tickChess(state, 1_000 + TURN_MS);
    expect(state.lastResult).toEqual({
      winnerUserId: 2,
      draw: false,
      reason: 'timeout',
    });
  });

  it('treats a lone minor as mating material only when the king is not bare', () => {
    // Black bishop against a white knight: the knight can block a flight
    // square, so a mate exists with help.
    const withBlocker = setup('k6b/8/8/8/8/8/8/K6N w - - 0 1');
    expect(hasMatingMaterial(withBlocker.board, 'b')).toBe(true);
    const bare = setup('k6b/8/8/8/8/8/8/K7 w - - 0 1');
    expect(hasMatingMaterial(bare.board, 'b')).toBe(false);
  });
});

describe('draw offers', () => {
  it('offers, accepts and ends the game as agreed', () => {
    const state = game();
    offerChessDraw(state, 1);
    expect(state.drawOffer).toBe(1);
    expect(playerOf(state, 'w').lastAction).toBe('Offered a draw');

    acceptChessDraw(state, 2);
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: null,
      draw: true,
      reason: 'agreement',
    });
    expect(playerOf(state, 'w').lastAction).toBe('Draw agreed');
    expect(playerOf(state, 'b').lastAction).toBe('Draw agreed');
    expect(state.drawOffer).toBeNull();
  });

  it('declines cleanly, leaving the game running', () => {
    const state = game();
    offerChessDraw(state, 1);
    declineChessDraw(state, 2);
    expect(state.drawOffer).toBeNull();
    expect(state.phase).toBe('playing');
    expect(playerOf(state, 'b').lastAction).toBe('Declined a draw');

    play(state, 1, 'e2', 'e4');
    expect(state.turn).toBe('b');
  });

  it("keeps the offer standing through the offeror's own move", () => {
    const state = game();
    offerChessDraw(state, 1);
    play(state, 1, 'e2', 'e4');
    expect(state.drawOffer).toBe(1);
    // A move by the other player answers the offer by playing on.
    play(state, 2, 'e7', 'e5');
    expect(state.drawOffer).toBeNull();
  });

  it('refuses offers that make no sense', () => {
    const state = game();
    expect(() => acceptChessDraw(state, 1)).toThrow('no draw offer');
    offerChessDraw(state, 1);
    expect(() => offerChessDraw(state, 1)).toThrow('already offered');
    expect(() => acceptChessDraw(state, 1)).toThrow('your own');
    expect(() => offerChessDraw(state, 2)).toThrow('Answer the draw offer');
    declineChessDraw(state, 2);
    expect(() => declineChessDraw(state, 2)).toThrow('no draw offer');

    resignChess(state, 1);
    expect(() => offerChessDraw(state, 1)).toThrow('No game is in progress');
  });
});

describe('persisted state compatibility', () => {
  it('fills clock fields on a state saved before clocks existed', () => {
    const state = game();
    // Strip the fields an older build never wrote.
    const legacy = state as unknown as Record<string, unknown>;
    delete legacy.clocks;
    delete legacy.turnStartedAt;
    delete legacy.timeControl;
    delete legacy.drawOffer;
    delete legacy.positionCounts;

    normalizeChessState(state);
    expect(state.timeControl).toBe('3+2');
    expect(state.clocks).toEqual({ w: TURN_MS, b: TURN_MS });
    expect(state.turnStartedAt).toBe(1_000);
    expect(state.drawOffer).toBeNull();
    expect(Object.keys(state.positionCounts)).toHaveLength(1);

    // And the game keeps playing after the patch.
    play(state, 1, 'e2', 'e4');
    expect(state.turn).toBe('b');
  });
});

describe('legal actions and leaving', () => {
  it('offers the twenty opening moves only to the player on the clock', () => {
    const state = game();
    const white = legalChessActions(state, 1);
    expect(white?.moves).toHaveLength(20);
    expect(white?.resign).toBe(true);
    expect(legalChessActions(state, 2)).toBeNull();
    play(state, 1, 'e2', 'e4');
    expect(legalChessActions(state, 1)).toBeNull();
    const black = legalChessActions(state, 2);
    expect(black?.moves).toHaveLength(20);
    expect(black?.moves.some((move) => move.from === 'g8' && move.to === 'f6')).toBe(
      true,
    );
  });

  it('generates castling and promotion as legal moves', () => {
    const castle = setup('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const castleMoves = generateLegalMoves(castle);
    expect(castleMoves.some((move) => move.castle === 'k')).toBe(true);
    expect(castleMoves.some((move) => move.castle === 'q')).toBe(true);

    const promotion = setup('k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
    const promotions = generateLegalMoves(promotion).filter(
      (move) => move.from === 'e7',
    );
    expect(promotions.map((move) => move.promotion).sort()).toEqual([
      'b',
      'n',
      'q',
      'r',
    ]);
  });

  it('asks both seats to ready up before starting', () => {
    const state = createChessState();
    expect(everyoneChessReady(state, [1, 2])).toBe(false);
    markChessReady(state, 1);
    expect(everyoneChessReady(state, [1, 2])).toBe(false);
    markChessReady(state, 2);
    expect(everyoneChessReady(state, [1, 2])).toBe(true);
    expect(everyoneChessReady(state, [1])).toBe(false);
  });

  it('ends the game when one player leaves mid-game', () => {
    const state = game();
    leaveChess(state, 2);
    expect(state.players.map((player) => player.userId)).toEqual([1]);
    expect(state.phase).toBe('finished');
    expect(state.lastResult).toEqual({
      winnerUserId: 1,
      draw: false,
      reason: 'abandoned',
    });
  });

  it('cleans up ready flags between games', () => {
    const state = createChessState();
    markChessReady(state, 1);
    markChessReady(state, 2);
    leaveChess(state, 2);
    // Waiting tables build their player list at kickoff, so only ready flags exist.
    expect(state.players).toEqual([]);
    expect(state.ready).toEqual([1]);
    expect(state.phase).toBe('waiting');
  });
});

describe('FEN round trip', () => {
  it('reads back exactly what it wrote', () => {
    const state = game();
    const fen = exportChessFen(state);
    expect(fen).toBe(
      'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    );
    const clone = createChessState();
    importChessFen(clone, fen);
    expect(clone.board).toEqual(state.board);
    expect(clone.castling).toEqual(state.castling);
    expect(clone.turn).toBe('w');
  });
});
