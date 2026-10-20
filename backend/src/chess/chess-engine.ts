/**
 * Chess engine — pure functions over a serialisable state, exactly like the
 * poker and Ludo engines, so the tables service can persist mid-game state in
 * jsonb.
 *
 * Board model: a 64-element array indexed like a FEN board — index 0 is a8
 * (black's queenside) and index 63 is h1 (white's kingside). Pieces are
 * `{ type, color }`, squares travel over the wire as regular names ("e2").
 *
 * Rules implemented: castling (with all the "not through check" cases),
 * en passant, promotion, check, checkmate, stalemate, resignation, clocks
 * with a per-player bank and a Fischer increment, draws agreed by the two
 * players, threefold repetition, the fifty-move rule, insufficient material,
 * and the FIDE rule that a flag only wins when the opponent can still mate.
 *
 * The side to move is the user the server last put on the clock; polling
 * clients drive `tickChess`. A flag fall never plays a move for anyone — a
 * chess clock is not a turn timer, so the game simply ends.
 */

export type ChessColor = 'w' | 'b';
export type ChessPieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type ChessPromotion = 'q' | 'r' | 'b' | 'n';
export type ChessPhase = 'waiting' | 'playing' | 'finished';

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'abandoned'
  | 'timeout'
  | 'fifty-move'
  | 'insufficient-material'
  | 'threefold'
  | 'agreement';

export interface ChessPiece {
  type: ChessPieceType;
  color: ChessColor;
}

export type ChessBoard = (ChessPiece | null)[];

export interface ChessCastlingRights {
  wK: boolean;
  wQ: boolean;
  bK: boolean;
  bQ: boolean;
}

/** A fully described move, before it is written to the game's move log. */
export interface ChessMove {
  from: string;
  to: string;
  piece: ChessPieceType;
  color: ChessColor;
  /** Piece taken, or null. En passant reports the taken pawn. */
  captured: ChessPieceType | null;
  /** Queenside or kingside castle, or null. */
  castle: 'k' | 'q' | null;
  /** The pawn pair is captured in passing. */
  enPassant: boolean;
  promotion: ChessPromotion | null;
}

/** One entry of the game's move log, with the SAN the room displays. */
export interface ChessMoveRecord {
  from: string;
  to: string;
  san: string;
  piece: ChessPieceType;
  color: ChessColor;
  captured: ChessPieceType | null;
  promotion: ChessPromotion | null;
  check: boolean;
  checkmate: boolean;
}

export interface ChessPlayer {
  userId: number;
  seatIndex: number;
  color: ChessColor;
  lastAction: string | null;
}

export interface ChessResult {
  winnerUserId: number | null;
  draw: boolean;
  reason: ChessEndReason;
}

/**
 * A clock a table can be created with. The id ("3+2") is what the API and the
 * jsonb state carry; the milliseconds live here only, so a client never has
 * to re-derive a rule from a string.
 */
export interface ChessTimeControl {
  id: string;
  initialMs: number;
  incrementMs: number;
}

const BULLET_1_0: ChessTimeControl = {
  id: '1+0',
  initialMs: 60_000,
  incrementMs: 0,
};
const BLITZ_3_2: ChessTimeControl = {
  id: '3+2',
  initialMs: 180_000,
  incrementMs: 2_000,
};
const BLITZ_5_0: ChessTimeControl = {
  id: '5+0',
  initialMs: 300_000,
  incrementMs: 0,
};
const RAPID_10_5: ChessTimeControl = {
  id: '10+5',
  initialMs: 600_000,
  incrementMs: 5_000,
};

export const CHESS_TIME_CONTROLS: ChessTimeControl[] = [
  BULLET_1_0,
  BLITZ_3_2,
  BLITZ_5_0,
  RAPID_10_5,
];

export const CHESS_TIME_CONTROL_IDS = CHESS_TIME_CONTROLS.map(
  (control) => control.id,
);

/** Three minutes plus a two-second increment — the old per-move budget. */
export const DEFAULT_CHESS_TIME_CONTROL = BLITZ_3_2.id;

export function findChessTimeControl(
  id: string | null | undefined,
): ChessTimeControl {
  if (!id) {
    return BLITZ_3_2;
  }
  return CHESS_TIME_CONTROLS.find((control) => control.id === id) ?? BLITZ_3_2;
}

export interface ChessState {
  phase: ChessPhase;
  gameNumber: number;
  /** The clock chosen at creation, an id from CHESS_TIME_CONTROLS. */
  timeControl: string;
  /** Each player's remaining bank, in milliseconds. */
  clocks: Record<ChessColor, number>;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** When the current turn's clock started — the elapsed time is charged on the move. */
  turnStartedAt: number | null;
  turn: ChessColor;
  board: ChessBoard;
  castling: ChessCastlingRights;
  /** The square a double pawn push skipped over, or null. */
  enPassant: string | null;
  /** Plies since the last pawn move or capture — 100 draws. */
  halfmoveClock: number;
  fullmoveNumber: number;
  players: ChessPlayer[];
  ready: number[];
  moves: ChessMoveRecord[];
  lastResult: ChessResult | null;
  /** The player with a standing draw offer, or null. */
  drawOffer: number | null;
  /** How often each position has been seen, for the threefold rule. */
  positionCounts: Record<string, number>;
}

/** One move the viewer may send; a pawn promotion carries its piece. */
export interface ChessLegalMove {
  from: string;
  to: string;
  promotion: ChessPromotion | null;
  /** 'k' or 'q' when the move is a castle, so the room can point it out. */
  castle: 'k' | 'q' | null;
}

export interface ChessLegalActions {
  moves: ChessLegalMove[];
  resign: boolean;
}

export interface ChessSeatInput {
  userId: number;
  seatIndex: number;
}

export interface StartChessOptions {
  seats: ChessSeatInput[];
  /** An id from CHESS_TIME_CONTROLS — unknown ids fall back to the default. */
  timeControl: string;
  now: number;
}

export class ChessError extends Error {}

export const CHESS_FILES = 'abcdefgh';
const BACK_RANK: ChessPieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

export function otherColor(color: ChessColor): ChessColor {
  return color === 'w' ? 'b' : 'w';
}

export function isSquareName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-h][1-8]$/.test(value);
}

/** Index of a square, 0 = a8 ... 63 = h1 (the FEN board order). */
export function squareToIndex(square: string): number {
  const file = CHESS_FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return (8 - rank) * 8 + file;
}

export function indexToSquare(index: number): string {
  return `${CHESS_FILES[index % 8]}${8 - Math.floor(index / 8)}`;
}

/** The starting position. */
export function initialChessBoard(): ChessBoard {
  const board: ChessBoard = Array.from({ length: 64 }, () => null);
  for (let file = 0; file < 8; file += 1) {
    board[file] = { type: BACK_RANK[file], color: 'b' };
    board[8 + file] = { type: 'p', color: 'b' };
    board[48 + file] = { type: 'p', color: 'w' };
    board[56 + file] = { type: BACK_RANK[file], color: 'w' };
  }
  return board;
}

export function createChessState(timeControl?: string): ChessState {
  const control = findChessTimeControl(timeControl ?? DEFAULT_CHESS_TIME_CONTROL);
  const state: ChessState = {
    phase: 'waiting',
    gameNumber: 0,
    timeControl: control.id,
    clocks: { w: control.initialMs, b: control.initialMs },
    turnUserId: null,
    turnDeadline: null,
    turnStartedAt: null,
    turn: 'w',
    board: initialChessBoard(),
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null,
    halfmoveClock: 0,
    fullmoveNumber: 1,
    players: [],
    ready: [],
    moves: [],
    lastResult: null,
    drawOffer: null,
    positionCounts: {},
  };
  state.positionCounts[repetitionKey(state)] = 1;
  return state;
}

/**
 * The en passant square a pawn could really be captured on, or null.
 *
 * FIDE 9.2.2: two positions are the same when the possible moves of all the
 * pieces are the same, so a square that no pawn can capture on does not make
 * a position different from the same position without that square.
 */
function capturableEnPassant(state: ChessState): string | null {
  const target = state.enPassant;
  if (!target) {
    return null;
  }
  const index = squareToIndex(target);
  const row = Math.floor(index / 8);
  const col = index % 8;
  // A white pawn captures the target from the row below it, a black pawn from
  // the row above it — one rank further down the board.
  const capturerRow = state.turn === 'w' ? row + 1 : row - 1;
  if (capturerRow < 0 || capturerRow > 7) {
    return null;
  }
  for (const file of [col - 1, col + 1]) {
    if (file < 0 || file > 7) {
      continue;
    }
    const piece = state.board[capturerRow * 8 + file];
    if (piece && piece.type === 'p' && piece.color === state.turn) {
      return target;
    }
  }
  return null;
}

/**
 * What makes two positions "the same" for the threefold rule: the pieces, the
 * side to move, the castling rights and the en passant square. The move
 * counters are deliberately left out, so a position reached on move 40 still
 * counts against the same position seen on move 12.
 */
export function repetitionKey(state: ChessState): string {
  const fen = exportChessFen(state).split(' ');
  fen[3] = capturableEnPassant(state) ?? '-';
  return fen.slice(0, 4).join(' ');
}

/** Records the current position and returns how often it has now been seen. */
function countPosition(state: ChessState): number {
  const key = repetitionKey(state);
  const seen = (state.positionCounts[key] ?? 0) + 1;
  state.positionCounts[key] = seen;
  return seen;
}

/**
 * Fills the fields introduced after a state was first written to the database,
 * so a game persisted by an older build keeps playing instead of crashing on
 * a missing clock.
 */
export function normalizeChessState(state: ChessState): void {
  const control = findChessTimeControl(state.timeControl);
  if (typeof state.timeControl !== 'string') {
    state.timeControl = control.id;
  }
  if (!state.clocks || typeof state.clocks.w !== 'number' || typeof state.clocks.b !== 'number') {
    // Before clocks were banks, every move had the same budget: give both
    // players a full bank rather than inventing spent time.
    state.clocks = { w: control.initialMs, b: control.initialMs };
  }
  if (
    state.turnStartedAt == null &&
    state.phase === 'playing' &&
    state.turnDeadline != null
  ) {
    state.turnStartedAt = Math.max(0, state.turnDeadline - state.clocks[state.turn]);
  }
  state.drawOffer = state.drawOffer ?? null;
  state.positionCounts = state.positionCounts ?? {};
  if (Object.keys(state.positionCounts).length === 0) {
    state.positionCounts[repetitionKey(state)] = 1;
  }
}

export function isChessPlaying(state: ChessState): boolean {
  return state.phase === 'playing';
}

function findPlayer(state: ChessState, userId: number): ChessPlayer | null {
  return state.players.find((player) => player.userId === userId) ?? null;
}

/** The king of `color`, or -1 on a board without one. */
function kingIndex(board: ChessBoard, color: ChessColor): number {
  return board.findIndex(
    (piece) => piece != null && piece.type === 'k' && piece.color === color,
  );
}

/**
 * True when `square` is attacked by any piece of `byColor`. Used for checks,
 * castling paths and mate detection.
 */
export function isSquareAttacked(
  board: ChessBoard,
  square: number,
  byColor: ChessColor,
): boolean {
  if (square < 0 || square > 63) {
    return false;
  }
  const row = Math.floor(square / 8);
  const col = square % 8;
  const at = (r: number, c: number): number =>
    r >= 0 && r < 8 && c >= 0 && c < 8 ? r * 8 + c : -1;
  const is = (index: number, type: ChessPieceType): boolean => {
    const piece = index >= 0 ? board[index] : null;
    return piece != null && piece.type === type && piece.color === byColor;
  };

  // Pawns: a white pawn attacks the squares below it, a black pawn above.
  const pawnRow = byColor === 'w' ? row + 1 : row - 1;
  if (is(at(pawnRow, col - 1), 'p') || is(at(pawnRow, col + 1), 'p')) {
    return true;
  }

  // Knights.
  for (const [dr, dc] of [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
  ]) {
    if (is(at(row + dr, col + dc), 'n')) {
      return true;
    }
  }

  // The enemy king.
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      if ((dr !== 0 || dc !== 0) && is(at(row + dr, col + dc), 'k')) {
        return true;
      }
    }
  }

  // Sliders: rooks and queens on ranks/files, bishops and queens diagonally.
  for (const [dr, dc, type] of [
    [1, 0, 'r'],
    [-1, 0, 'r'],
    [0, 1, 'r'],
    [0, -1, 'r'],
    [1, 1, 'b'],
    [1, -1, 'b'],
    [-1, 1, 'b'],
    [-1, -1, 'b'],
  ] as Array<[number, number, ChessPieceType]>) {
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < 8 && c >= 0 && c < 8) {
      const index = r * 8 + c;
      const piece = board[index];
      if (piece) {
        if (piece.color === byColor && (piece.type === type || piece.type === 'q')) {
          return true;
        }
        break;
      }
      r += dr;
      c += dc;
    }
  }

  return false;
}

export function isInCheck(board: ChessBoard, color: ChessColor): boolean {
  return isSquareAttacked(board, kingIndex(board, color), otherColor(color));
}

function move(
  piece: ChessPiece,
  from: number,
  to: number,
  extra: Partial<ChessMove> = {},
): ChessMove {
  return {
    from: indexToSquare(from),
    to: indexToSquare(to),
    piece: piece.type,
    color: piece.color,
    captured: null,
    castle: null,
    enPassant: false,
    promotion: null,
    ...extra,
  };
}

/** A pawn move, wired for every promotion choice when it reaches the last rank. */
function pawnMoves(
  piece: ChessPiece,
  from: number,
  to: number,
  captured: ChessPieceType | null,
  enPassant: boolean,
  promotionRow: number,
): ChessMove[] {
  const extra = { captured, enPassant };
  if (Math.floor(to / 8) === promotionRow) {
    return (['q', 'r', 'b', 'n'] as ChessPromotion[]).map((promotion) =>
      move(piece, from, to, { ...extra, promotion }),
    );
  }
  return [move(piece, from, to, extra)];
}

/** Every pseudo-legal move for `color` — castling paths checked, no filters. */
function generatePseudoMoves(state: ChessState, color: ChessColor): ChessMove[] {
  const { board } = state;
  const moves: ChessMove[] = [];
  const at = (row: number, col: number): number =>
    row >= 0 && row < 8 && col >= 0 && col < 8 ? row * 8 + col : -1;

  board.forEach((piece, index) => {
    if (!piece || piece.color !== color) {
      return;
    }
    const row = Math.floor(index / 8);
    const col = index % 8;

    if (piece.type === 'p') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      const promotionRow = color === 'w' ? 0 : 7;

      const one = at(row + dir, col);
      if (one >= 0 && !board[one]) {
        moves.push(...pawnMoves(piece, index, one, null, false, promotionRow));
        const two = at(row + 2 * dir, col);
        if (row === startRow && two >= 0 && !board[two]) {
          moves.push(move(piece, index, two));
        }
      }
      for (const dc of [-1, 1]) {
        const target = at(row + dir, col + dc);
        if (target < 0) {
          continue;
        }
        const occupant = board[target];
        if (occupant && occupant.color !== color) {
          moves.push(
            ...pawnMoves(piece, index, target, occupant.type, false, promotionRow),
          );
        } else if (!occupant && state.enPassant === indexToSquare(target)) {
          moves.push(
            ...pawnMoves(piece, index, target, 'p', true, promotionRow),
          );
        }
      }
      return;
    }

    if (piece.type === 'n' || piece.type === 'k') {
      const steps: Array<[number, number]> =
        piece.type === 'n'
          ? [
              [1, 2],
              [2, 1],
              [2, -1],
              [1, -2],
              [-1, -2],
              [-2, -1],
              [-2, 1],
              [-1, 2],
            ]
          : [
              [0, 1],
              [1, 1],
              [1, 0],
              [1, -1],
              [0, -1],
              [-1, -1],
              [-1, 0],
              [-1, 1],
            ];
      for (const [dr, dc] of steps) {
        const target = at(row + dr, col + dc);
        if (target < 0) {
          continue;
        }
        const occupant = board[target];
        if (occupant && occupant.color === color) {
          continue;
        }
        moves.push(move(piece, index, target, { captured: occupant?.type ?? null }));
      }

      // FIDE 3.8.2.2: castling is prevented temporarily when the square the
      // king stands on, the square it must cross, or the square it is to
      // occupy is attacked by an enemy piece — and when there is a piece
      // between the king and the rook. The rook itself may be under attack.
      if (piece.type === 'k' && !isSquareAttacked(board, index, otherColor(color))) {
        const home = color === 'w' ? 7 : 0;
        if (index === at(home, 4)) {
          const kingside = color === 'w' ? state.castling.wK : state.castling.bK;
          const queenside = color === 'w' ? state.castling.wQ : state.castling.bQ;
          const rookOn = (file: number): boolean => {
            const piece = board[at(home, file)];
            return piece != null && piece.type === 'r' && piece.color === color;
          };
          if (
            kingside &&
            rookOn(7) &&
            !board[at(home, 5)] &&
            !board[at(home, 6)] &&
            !isSquareAttacked(board, at(home, 5), otherColor(color)) &&
            !isSquareAttacked(board, at(home, 6), otherColor(color))
          ) {
            moves.push(move(piece, index, at(home, 6), { castle: 'k' }));
          }
          if (
            queenside &&
            rookOn(0) &&
            !board[at(home, 1)] &&
            !board[at(home, 2)] &&
            !board[at(home, 3)] &&
            !isSquareAttacked(board, at(home, 3), otherColor(color)) &&
            !isSquareAttacked(board, at(home, 2), otherColor(color))
          ) {
            moves.push(move(piece, index, at(home, 2), { castle: 'q' }));
          }
        }
      }
      return;
    }

    // Sliders.
    const dirs: Array<[number, number]> =
      piece.type === 'b'
        ? [
            [1, 1],
            [1, -1],
            [-1, 1],
            [-1, -1],
          ]
        : piece.type === 'r'
          ? [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ]
          : [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
              [1, 1],
              [1, -1],
              [-1, 1],
              [-1, -1],
            ];
    for (const [dr, dc] of dirs) {
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const target = r * 8 + c;
        const occupant = board[target];
        if (!occupant) {
          moves.push(move(piece, index, target));
        } else {
          if (occupant.color !== color) {
            moves.push(move(piece, index, target, { captured: occupant.type }));
          }
          break;
        }
        r += dr;
        c += dc;
      }
    }
  });

  return moves;
}

/** The board after a move, castling rooks and en passant included. */
function applyMoveToBoard(board: ChessBoard, move: ChessMove): ChessBoard {
  const next = [...board];
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  const piece = next[from];
  next[from] = null;
  if (move.enPassant) {
    next[squareToIndex(`${move.to[0]}${move.from[1]}`)] = null;
  }
  if (move.castle) {
    const home = from < 32 ? 0 : 7;
    const rookFrom = home * 8 + (move.castle === 'k' ? 7 : 0);
    const rookTo = home * 8 + (move.castle === 'k' ? 5 : 3);
    next[rookTo] = next[rookFrom];
    next[rookFrom] = null;
  }
  next[to] = piece
    ? {
        type: move.promotion ?? piece.type,
        color: piece.color,
      }
    : null;
  return next;
}

/** Every legal move for the side to move in `state`. */
export function generateLegalMoves(state: ChessState): ChessMove[] {
  return generatePseudoMoves(state, state.turn).filter((candidate) => {
    const board = applyMoveToBoard(state.board, candidate);
    const king = kingIndex(board, candidate.color);
    return king < 0 || !isSquareAttacked(board, king, otherColor(candidate.color));
  });
}

const PIECE_LETTERS: Record<ChessPieceType, string> = {
  k: 'K',
  q: 'Q',
  r: 'R',
  b: 'B',
  n: 'N',
  p: '',
};

/** Standard algebraic notation for a move, check/mate suffix added later. */
function sanBase(move: ChessMove, all: ChessMove[]): string {
  if (move.castle === 'k') {
    return 'O-O';
  }
  if (move.castle === 'q') {
    return 'O-O-O';
  }

  const capture = move.captured != null ? 'x' : '';
  const promotion = move.promotion ? `=${PIECE_LETTERS[move.promotion]}` : '';

  if (move.piece === 'p') {
    const from = capture ? move.from[0] : '';
    return `${from}${capture}${move.to}${promotion}`;
  }

  // Disambiguate two identical pieces that could reach the same square.
  const twins = all.filter(
    (candidate) =>
      candidate.piece === move.piece &&
      candidate.color === move.color &&
      candidate.to === move.to &&
      candidate.from !== move.from,
  );
  let origin = '';
  if (twins.length > 0) {
    const sameFile = twins.some((candidate) => candidate.from[0] === move.from[0]);
    const sameRank = twins.some((candidate) => candidate.from[1] === move.from[1]);
    origin = !sameFile ? move.from[0] : !sameRank ? move.from[1] : move.from;
  }
  return `${PIECE_LETTERS[move.piece]}${origin}${capture}${move.to}${promotion}`;
}

function updateCastlingRights(state: ChessState, move: ChessMove): void {
  const from = squareToIndex(move.from);
  const to = squareToIndex(move.to);
  const touching = (index: number): boolean => index === from || index === to;
  const corner = (rank: number, file: number): number => rank * 8 + file;
  if (move.piece === 'k') {
    if (move.color === 'w') {
      state.castling.wK = false;
      state.castling.wQ = false;
    } else {
      state.castling.bK = false;
      state.castling.bQ = false;
    }
    return;
  }
  if (touching(corner(7, 7))) {
    state.castling.wK = false;
  }
  if (touching(corner(7, 0))) {
    state.castling.wQ = false;
  }
  if (touching(corner(0, 7))) {
    state.castling.bK = false;
  }
  if (touching(corner(0, 0))) {
    state.castling.bQ = false;
  }
}

/** The en passant square a double pawn push creates, or null. */
function enPassantTarget(move: ChessMove): string | null {
  if (move.piece !== 'p' || move.captured != null) {
    return null;
  }
  const fromRank = Number(move.from[1]);
  const toRank = Number(move.to[1]);
  if (Math.abs(fromRank - toRank) !== 2) {
    return null;
  }
  return `${move.from[0]}${(fromRank + toRank) / 2}`;
}

/** The colour of a square: true for light, false for dark. */
function isLightSquare(index: number): boolean {
  const row = Math.floor(index / 8);
  const col = index % 8;
  // a8 (row 0, col 0) is light, a1 (row 7, col 0) is dark.
  return (row + col) % 2 === 0;
}

/**
 * FIDE 5.2.2 — a dead position: one in which neither player can checkmate.
 * Without a pawn, a rook or a queen on the board, the game is dead when
 *
 *   - only the kings are left (K vs K),
 *   - one side has a single minor and the other only its king (K+B vs K,
 *     K+N vs K),
 *   - both sides have a single bishop on squares of the same colour (the
 *     classic same-coloured bishops),
 *   - one side has two knights and the other only its king (a bare king can
 *     never be mated by two knights).
 *
 * Everything else can still be mated with the defender's help: two knights,
 * a bishop and a knight, or two bishops on opposite colours all carry a
 * mating net.
 */
export function hasInsufficientMaterial(board: ChessBoard): boolean {
  const minors: Record<ChessColor, ChessPieceType[]> = { w: [], b: [] };
  const squares: Record<ChessColor, number[]> = { w: [], b: [] };
  for (let index = 0; index < board.length; index += 1) {
    const piece = board[index];
    if (!piece || piece.type === 'k') {
      continue;
    }
    if (piece.type === 'p' || piece.type === 'r' || piece.type === 'q') {
      // A pawn, rook or queen can always lead to a mate — never dead.
      return false;
    }
    minors[piece.color].push(piece.type);
    squares[piece.color].push(index);
  }

  const white = minors.w.length;
  const black = minors.b.length;

  if (white + black === 0) {
    // King against king.
    return true;
  }
  if (white + black === 1) {
    // King and a single minor against a bare king.
    return true;
  }
  if (white === 2 && black === 0) {
    return minors.w.every((type) => type === 'n');
  }
  if (black === 2 && white === 0) {
    return minors.b.every((type) => type === 'n');
  }
  if (white === 1 && black === 1) {
    if (minors.w[0] === 'b' && minors.b[0] === 'b') {
      // Two bishops are dead only on the same colour complex.
      return (
        isLightSquare(squares.w[0]) === isLightSquare(squares.b[0])
      );
    }
    // Two knights (or a bishop against a knight) can still be mated.
    return false;
  }
  return false;
}

/**
 * Could `color` checkmate at all, allowing the opponent to help? True with a
 * pawn, rook or queen; two minors are enough (bishop pair, or two knights
 * with help); a single minor needs the defender's own piece to block a flight
 * square, because a bare king can never be mated.
 *
 * This is the practical reading of FIDE 6.9 used for flag falls. It is
 * deliberately generous — a lone bishop against a lone bishop is reported as
 * "can mate" even when the bishops share a colour — so the clock never steals
 * a win that a player could still have earned.
 */
export function hasMatingMaterial(
  board: ChessBoard,
  color: ChessColor,
): boolean {
  let minors = 0;
  let blockers = 0;
  for (const piece of board) {
    if (!piece || piece.type === 'k') {
      continue;
    }
    if (piece.color !== color) {
      blockers += 1;
      continue;
    }
    if (piece.type === 'p' || piece.type === 'r' || piece.type === 'q') {
      return true;
    }
    minors += 1;
  }
  if (minors >= 2) {
    return true;
  }
  return minors === 1 && blockers > 0;
}

function finishChess(state: ChessState, result: ChessResult): void {
  state.phase = 'finished';
  state.turnUserId = null;
  state.turnDeadline = null;
  state.turnStartedAt = null;
  state.drawOffer = null;
  state.ready = [];
  state.lastResult = result;
}

/**
 * Makes a legal move for the player on the clock, updating the clocks, the
 * castling rights, en passant, the move log and the result when the move ends
 * the game.
 */
function playMove(state: ChessState, move: ChessMove, now: number): void {
  normalizeChessState(state);
  const all = generateLegalMoves(state);
  const san = sanBase(move, all);
  const mover = findPlayer(state, state.turnUserId ?? -1);

  // Charge the mover for the time they took, then add their increment.
  const control = findChessTimeControl(state.timeControl);
  if (state.turnStartedAt != null) {
    const spent = Math.max(0, now - state.turnStartedAt);
    state.clocks[move.color] = Math.max(0, state.clocks[move.color] - spent);
  }
  state.clocks[move.color] += control.incrementMs;
  // An answer by the other player is a declined offer; the offeror's own move
  // keeps it standing, so a draw can be offered along with a move.
  if (state.drawOffer != null && state.drawOffer !== mover?.userId) {
    state.drawOffer = null;
  }

  state.board = applyMoveToBoard(state.board, move);
  updateCastlingRights(state, move);
  state.enPassant = enPassantTarget(move);
  state.halfmoveClock =
    move.piece === 'p' || move.captured != null ? 0 : state.halfmoveClock + 1;
  if (move.color === 'b') {
    state.fullmoveNumber += 1;
  }
  state.turn = otherColor(move.color);
  const repetitions = countPosition(state);

  const check = isInCheck(state.board, state.turn);
  const replies = generateLegalMoves(state);
  const checkmate = check && replies.length === 0;
  const stalemate = !check && replies.length === 0;
  const record: ChessMoveRecord = {
    from: move.from,
    to: move.to,
    san: `${san}${checkmate ? '#' : check ? '+' : ''}`,
    piece: move.piece,
    color: move.color,
    captured: move.captured,
    promotion: move.promotion,
    check,
    checkmate,
  };
  state.moves.push(record);
  if (mover) {
    mover.lastAction = record.san;
  }

  if (checkmate) {
    finishChess(state, {
      winnerUserId: mover?.userId ?? null,
      draw: false,
      reason: 'checkmate',
    });
    return;
  }
  if (stalemate) {
    finishChess(state, { winnerUserId: null, draw: true, reason: 'stalemate' });
    return;
  }
  if (repetitions >= 3) {
    finishChess(state, { winnerUserId: null, draw: true, reason: 'threefold' });
    return;
  }
  if (state.halfmoveClock >= 100) {
    finishChess(state, { winnerUserId: null, draw: true, reason: 'fifty-move' });
    return;
  }
  if (hasInsufficientMaterial(state.board)) {
    finishChess(state, {
      winnerUserId: null,
      draw: true,
      reason: 'insufficient-material',
    });
    return;
  }

  const next = state.players.find((player) => player.color === state.turn);
  state.turnUserId = next?.userId ?? null;
  state.turnStartedAt = now;
  state.turnDeadline = now + state.clocks[state.turn];
}

export function markChessReady(state: ChessState, userId: number): void {
  if (state.phase === 'playing') {
    throw new ChessError('A game is already running');
  }
  if (!state.ready.includes(userId)) {
    state.ready.push(userId);
  }
}

export function everyoneChessReady(
  state: ChessState,
  seatUserIds: number[],
): boolean {
  return (
    seatUserIds.length === 2 &&
    seatUserIds.every((id) => state.ready.includes(id))
  );
}

export function startChess(state: ChessState, opts: StartChessOptions): void {
  if (state.phase === 'playing') {
    throw new ChessError('A game is already running');
  }
  if (opts.seats.length !== 2) {
    throw new ChessError('Chess needs exactly two players');
  }

  const seats = [...opts.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  const control = findChessTimeControl(opts.timeControl);
  state.phase = 'playing';
  state.gameNumber += 1;
  state.timeControl = control.id;
  state.clocks = { w: control.initialMs, b: control.initialMs };
  state.turn = 'w';
  state.board = initialChessBoard();
  state.castling = { wK: true, wQ: true, bK: true, bQ: true };
  state.enPassant = null;
  state.halfmoveClock = 0;
  state.fullmoveNumber = 1;
  state.moves = [];
  state.ready = [];
  state.lastResult = null;
  state.drawOffer = null;
  state.positionCounts = {};
  state.positionCounts[repetitionKey(state)] = 1;

  // Colours alternate between games so nobody always moves first.
  const whiteFirst = state.gameNumber % 2 === 1;
  state.players = seats.map((seat, index) => ({
    userId: seat.userId,
    seatIndex: seat.seatIndex,
    color: ((index === 0) === whiteFirst ? 'w' : 'b') as ChessColor,
    lastAction: null,
  }));

  const white = state.players.find((player) => player.color === 'w');
  state.turnUserId = white?.userId ?? null;
  state.turnStartedAt = opts.now;
  state.turnDeadline = opts.now + state.clocks.w;
}

/** What the viewer may play right now — null when it is not their turn. */
export function legalChessActions(
  state: ChessState,
  userId: number,
): ChessLegalActions | null {
  if (state.phase !== 'playing') {
    return null;
  }
  const player = findPlayer(state, userId);
  if (!player || state.turnUserId !== userId) {
    return null;
  }
  return {
    moves: generateLegalMoves(state).map((move) => ({
      from: move.from,
      to: move.to,
      promotion: move.promotion,
      castle: move.castle,
    })),
    resign: true,
  };
}

/** Plays the viewer's move; throws when the move is not legal. */
export function playChessMove(
  state: ChessState,
  userId: number,
  from: string,
  to: string,
  promotion: ChessPromotion | null,
  now: number,
): void {
  if (state.phase !== 'playing') {
    throw new ChessError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new ChessError('You are not in this game');
  }
  if (state.turnUserId !== userId || player.color !== state.turn) {
    throw new ChessError('It is not your turn');
  }
  if (state.turnDeadline != null && now >= state.turnDeadline) {
    // The flag fell before the move arrived — the service ticks first, this
    // is the engine standing on its own.
    throw new ChessError('The clock ran out');
  }
  if (!isSquareName(from) || !isSquareName(to)) {
    throw new ChessError('Name the squares like e2 and e4');
  }

  const all = generateLegalMoves(state);
  const requested = promotion ?? null;
  let move =
    all.find(
      (candidate) =>
        candidate.from === from &&
        candidate.to === to &&
        candidate.promotion === requested,
    ) ?? null;
  if (!move && requested == null) {
    // A pawn promotion without a chosen piece is a queen, like most clients.
    move =
      all.find(
        (candidate) =>
          candidate.from === from &&
          candidate.to === to &&
          candidate.promotion === 'q',
      ) ?? null;
  }
  if (!move) {
    throw new ChessError('That move is not allowed');
  }

  playMove(state, move, now);
}

/** Resigning is always legal while a game runs. */
export function resignChess(state: ChessState, userId: number): void {
  if (state.phase !== 'playing') {
    throw new ChessError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new ChessError('You are not in this game');
  }
  const winner = state.players.find((candidate) => candidate.userId !== userId) ?? null;
  player.lastAction = 'Resigned';
  if (winner) {
    winner.lastAction = 'Won by resignation';
  }
  finishChess(state, {
    winnerUserId: winner?.userId ?? null,
    draw: winner == null,
    reason: 'resignation',
  });
}

/** The other player's offer, or a clear error when there is nothing to answer. */
function drawOfferToAnswer(state: ChessState, userId: number): number {
  if (state.phase !== 'playing') {
    throw new ChessError('No game is in progress');
  }
  if (!findPlayer(state, userId)) {
    throw new ChessError('You are not in this game');
  }
  if (state.drawOffer == null) {
    throw new ChessError('There is no draw offer to answer');
  }
  if (state.drawOffer === userId) {
    throw new ChessError('That is your own draw offer');
  }
  return state.drawOffer;
}

/** Offers a draw; the opponent accepts, declines, or simply plays on. */
export function offerChessDraw(state: ChessState, userId: number): void {
  if (state.phase !== 'playing') {
    throw new ChessError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new ChessError('You are not in this game');
  }
  if (state.drawOffer === userId) {
    throw new ChessError('You already offered a draw');
  }
  if (state.drawOffer != null) {
    throw new ChessError('Answer the draw offer first');
  }
  state.drawOffer = userId;
  player.lastAction = 'Offered a draw';
}

/** Accepting ends the game as a draw at once. */
export function acceptChessDraw(state: ChessState, userId: number): void {
  const offerorId = drawOfferToAnswer(state, userId);
  const offeror = findPlayer(state, offerorId);
  const answerer = findPlayer(state, userId);
  if (offeror) {
    offeror.lastAction = 'Draw agreed';
  }
  if (answerer) {
    answerer.lastAction = 'Draw agreed';
  }
  finishChess(state, {
    winnerUserId: null,
    draw: true,
    reason: 'agreement',
  });
}

/** Declining clears the offer; the game carries on exactly as it was. */
export function declineChessDraw(state: ChessState, userId: number): void {
  const offerorId = drawOfferToAnswer(state, userId);
  const offeror = findPlayer(state, offerorId);
  const answerer = findPlayer(state, userId);
  if (offeror) {
    offeror.lastAction = 'Draw declined';
  }
  if (answerer) {
    answerer.lastAction = 'Declined a draw';
  }
  state.drawOffer = null;
}

/**
 * Ends the game when the player on the clock runs out of time. The flag falls,
 * their bank goes to zero, and the opponent wins — unless the opponent could
 * not mate even with help, in which case the game is drawn instead of stolen.
 * Returns true when the clock was handled.
 */
export function tickChess(state: ChessState, now: number): boolean {
  if (
    state.phase !== 'playing' ||
    state.turnDeadline == null ||
    now < state.turnDeadline
  ) {
    return false;
  }
  normalizeChessState(state);
  const flaggedColor = state.turn;
  state.clocks[flaggedColor] = 0;

  const loser = findPlayer(state, state.turnUserId ?? -1);
  const winner = state.players.find((player) => player.userId !== loser?.userId) ?? null;
  if (loser) {
    loser.lastAction = 'Ran out of time';
  }

  // FIDE 6.9: a fallen flag only wins when the opponent still has mating
  // material. A dead position is drawn, and nobody loses by the clock.
  if (!hasMatingMaterial(state.board, otherColor(flaggedColor))) {
    if (loser) {
      loser.lastAction = 'Drew on time';
    }
    if (winner) {
      winner.lastAction = 'Drew on time';
    }
    finishChess(state, { winnerUserId: null, draw: true, reason: 'timeout' });
    return true;
  }

  if (winner) {
    winner.lastAction = 'Won on time';
  }
  finishChess(state, {
    winnerUserId: winner?.userId ?? null,
    draw: winner == null,
    reason: 'timeout',
  });
  return true;
}

/** Removes a player who left the table mid-game. */
export function leaveChess(state: ChessState, userId: number): void {
  state.ready = state.ready.filter((id) => id !== userId);
  state.players = state.players.filter((player) => player.userId !== userId);

  if (state.phase !== 'playing') {
    return;
  }
  // Chess is always heads-up: one player walking away ends the game.
  const survivor = state.players[0] ?? null;
  finishChess(state, {
    winnerUserId: survivor?.userId ?? null,
    draw: survivor == null,
    reason: 'abandoned',
  });
}

/** Fills the board from a FEN string — used by tests and future tooling. */
export function importChessFen(state: ChessState, fen: string): void {
  const [placement = '', turn = 'w', castling = '-', enPassant = '-', half, full] =
    fen.trim().split(/\s+/);
  const board: ChessBoard = Array.from({ length: 64 }, () => null);
  let index = 0;
  for (const char of placement) {
    if (char === '/') {
      continue;
    }
    if (/[1-8]/.test(char)) {
      index += Number(char);
      continue;
    }
    const piece: ChessPiece = {
      type: char.toLowerCase() as ChessPieceType,
      color: char === char.toUpperCase() ? 'w' : 'b',
    };
    board[index] = piece;
    index += 1;
  }
  state.board = board;
  state.turn = turn === 'b' ? 'b' : 'w';
  state.castling = {
    wK: castling.includes('K'),
    wQ: castling.includes('Q'),
    bK: castling.includes('k'),
    bQ: castling.includes('q'),
  };
  state.enPassant = enPassant === '-' ? null : enPassant;
  state.halfmoveClock = Number(half ?? 0) || 0;
  state.fullmoveNumber = Number(full ?? 1) || 1;
  // The imported position is a new game as far as repetition is concerned.
  state.positionCounts = {};
  state.positionCounts[repetitionKey(state)] = 1;
}

/** The FEN string for the current board — the inverse of importChessFen. */
export function exportChessFen(state: ChessState): string {
  let placement = '';
  for (let row = 0; row < 8; row += 1) {
    let empty = 0;
    for (let col = 0; col < 8; col += 1) {
      const piece = state.board[row * 8 + col];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty > 0) {
        placement += String(empty);
        empty = 0;
      }
      const letter = piece.type;
      placement += piece.color === 'w' ? letter.toUpperCase() : letter;
    }
    if (empty > 0) {
      placement += String(empty);
    }
    if (row < 7) {
      placement += '/';
    }
  }
  const castling =
    `${state.castling.wK ? 'K' : ''}${state.castling.wQ ? 'Q' : ''}${
      state.castling.bK ? 'k' : ''
    }${state.castling.bQ ? 'q' : ''}` || '-';
  return [
    placement,
    state.turn,
    castling,
    state.enPassant ?? '-',
    state.halfmoveClock,
    state.fullmoveNumber,
  ].join(' ');
}
