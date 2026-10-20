/**
 * Ludo engine — pure functions over a serialisable state, exactly like the
 * poker engine, so the tables service can persist mid-game state in jsonb.
 *
 * Board model: every player owns one quadrant of a 15x15 board (0 = top-left,
 * 1 = top-right, 2 = bottom-right, 3 = bottom-left) with a private home
 * column and its own start square on the shared 52-cell track.
 *
 * A token's `steps` is its progress from its own start square:
 *   -1          still in the base
 *   0..51       on the shared track (absolute cell = start + steps mod 52)
 *   52..56      inside the player's home column
 *   57          home (finished)
 *
 * Rules implemented: a six is needed to leave the base, sixes and captures
 * earn another roll, three sixes in a row lose the turn, the eight star
 * squares are safe from captures, and a token needs the exact roll to come
 * home. Polling clients drive `tickTimeouts`, which rolls or moves for a
 * player whose timer ran out — never a bot, only a stall of a real person.
 */

export type LudoPhase = 'waiting' | 'playing' | 'finished';

export type LudoActionType = 'roll' | 'move';

export interface LudoAction {
  type: LudoActionType;
  /** Which of your four tokens to move (0..3). */
  tokenId?: number;
}

export class LudoError extends Error {}

export const LUDO_TOKENS_PER_PLAYER = 4;
/** Cells on the shared ring. */
export const LUDO_TRACK_LENGTH = 52;
/** Progress of the first home-column cell. */
export const LUDO_HOME_COLUMN_START = 52;
/** Progress that means "home". */
export const LUDO_HOME_STEP = 57;
/** Track cell each quadrant enters the ring on. */
export const LUDO_START_INDEX = [12, 25, 38, 51];
/**
 * Star squares: each start plus the square eight steps later. Tokens resting
 * there can never be sent back to the base.
 */
export const LUDO_SAFE_CELLS: ReadonlySet<number> = new Set([
  7, 12, 20, 25, 33, 38, 46, 51,
]);

export interface LudoToken {
  steps: number;
}

export interface LudoPlayer {
  userId: number;
  seatIndex: number;
  /** 0..3, clockwise from the top-left base. */
  quadrant: number;
  tokens: LudoToken[];
  lastAction: string | null;
  /** Consecutive sixes in this turn — three of them lose the turn. */
  sixes: number;
}

export interface LudoResult {
  winnerUserId: number;
  homeCounts: { userId: number; home: number }[];
}

export interface LudoState {
  phase: LudoPhase;
  gameNumber: number;
  /** How long a player has to roll or move before the server plays for them. */
  turnMs: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** The roll waiting to be used; null while the player still has to roll. */
  dice: number | null;
  /** The most recent roll, kept for the dice display. */
  lastRoll: number | null;
  players: LudoPlayer[];
  ready: number[];
  lastResult: LudoResult | null;
}

export interface LudoMove {
  tokenId: number;
  /** Progress the token would land on. */
  steps: number;
  /** The move would send at least one opponent token back to its base. */
  capture: boolean;
}

export interface LudoLegalActions {
  roll: boolean;
  dice: number | null;
  moves: LudoMove[];
}

export interface LudoSeatInput {
  userId: number;
  seatIndex: number;
}

export interface StartLudoOptions {
  seats: LudoSeatInput[];
  turnMs: number;
  now: number;
}

export function createLudoState(): LudoState {
  return {
    phase: 'waiting',
    gameNumber: 0,
    turnMs: 45_000,
    turnUserId: null,
    turnDeadline: null,
    dice: null,
    lastRoll: null,
    players: [],
    ready: [],
    lastResult: null,
  };
}

export function isLudoPlaying(state: LudoState): boolean {
  return state.phase === 'playing';
}

/** Rolls one fair die. */
export function rollDie(random: () => number = Math.random): number {
  return Math.floor(random() * 6) + 1;
}

/** The shared track cell a token stands on, or null off the ring. */
export function absoluteCell(
  quadrant: number,
  steps: number,
): number | null {
  if (steps < 0 || steps > 51) {
    return null;
  }
  return (LUDO_START_INDEX[quadrant] + steps) % LUDO_TRACK_LENGTH;
}

export function homeCount(player: LudoPlayer): number {
  return player.tokens.filter((token) => token.steps >= LUDO_HOME_STEP).length;
}

function findPlayer(state: LudoState, userId: number): LudoPlayer | null {
  return state.players.find((player) => player.userId === userId) ?? null;
}

/**
 * Opponent tokens a move would capture: everything standing on the target
 * cell, unless the target is inside a home column or on a star square.
 */
export function capturesAt(
  state: LudoState,
  player: LudoPlayer,
  targetSteps: number,
): { player: LudoPlayer; tokens: LudoToken[] }[] {
  const cell = absoluteCell(player.quadrant, targetSteps);
  if (cell == null || LUDO_SAFE_CELLS.has(cell)) {
    return [];
  }
  const hits: { player: LudoPlayer; tokens: LudoToken[] }[] = [];
  for (const other of state.players) {
    if (other.userId === player.userId) {
      continue;
    }
    const tokens = other.tokens.filter(
      (token) => absoluteCell(other.quadrant, token.steps) === cell,
    );
    if (tokens.length > 0) {
      hits.push({ player: other, tokens });
    }
  }
  return hits;
}

/** Every legal token move for the player's pending roll. */
export function movesFor(state: LudoState, player: LudoPlayer): LudoMove[] {
  const dice = state.dice;
  if (dice == null) {
    return [];
  }
  const moves: LudoMove[] = [];
  player.tokens.forEach((token, tokenId) => {
    let steps: number;
    if (token.steps < 0) {
      if (dice !== 6) {
        return;
      }
      steps = 0;
    } else {
      if (token.steps >= LUDO_HOME_STEP) {
        return;
      }
      steps = token.steps + dice;
      if (steps > LUDO_HOME_STEP) {
        // Coming home needs the exact roll.
        return;
      }
    }
    moves.push({
      tokenId,
      steps,
      capture: capturesAt(state, player, steps).length > 0,
    });
  });
  return moves;
}

/** What the viewer may do right now — null when it is not their turn. */
export function legalLudoActions(
  state: LudoState,
  userId: number,
): LudoLegalActions | null {
  if (state.phase !== 'playing' || state.turnUserId !== userId) {
    return null;
  }
  const player = findPlayer(state, userId);
  if (!player) {
    return null;
  }
  return {
    roll: state.dice == null,
    dice: state.dice,
    moves: state.dice == null ? [] : movesFor(state, player),
  };
}

export function markLudoReady(state: LudoState, userId: number): void {
  if (state.phase === 'playing') {
    throw new LudoError('A game is already running');
  }
  if (!state.ready.includes(userId)) {
    state.ready.push(userId);
  }
}

export function everyoneLudoReady(
  state: LudoState,
  seatUserIds: number[],
): boolean {
  return (
    seatUserIds.length >= 2 &&
    seatUserIds.length <= 4 &&
    seatUserIds.every((id) => state.ready.includes(id))
  );
}

export function startLudo(state: LudoState, opts: StartLudoOptions): void {
  if (state.phase === 'playing') {
    throw new LudoError('A game is already running');
  }
  if (opts.seats.length < 2) {
    throw new LudoError('Ludo needs at least two players');
  }
  if (opts.seats.length > 4) {
    throw new LudoError('Ludo supports at most four players');
  }

  const seats = [...opts.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  // Heads-up sits opposite each other so both players race the same distance.
  const quadrants = seats.length === 2 ? [0, 2] : [0, 1, 2, 3];

  state.phase = 'playing';
  state.gameNumber += 1;
  state.turnMs = opts.turnMs;
  state.dice = null;
  state.lastRoll = null;
  state.ready = [];
  state.lastResult = null;
  state.players = seats.map((seat, index) => ({
    userId: seat.userId,
    seatIndex: seat.seatIndex,
    quadrant: quadrants[index],
    tokens: Array.from({ length: LUDO_TOKENS_PER_PLAYER }, () => ({
      steps: -1,
    })),
    lastAction: null,
    sixes: 0,
  }));

  // The starter rotates every game so nobody always rolls first.
  const starter =
    state.players[(state.gameNumber - 1) % state.players.length];
  state.turnUserId = starter.userId;
  state.turnDeadline = opts.now + state.turnMs;
}

/** Passes the turn to the next player, clearing the pending roll. */
function advanceTurn(state: LudoState, now: number): void {
  if (state.phase !== 'playing') {
    return;
  }
  const current = findPlayer(state, state.turnUserId ?? -1);
  if (current) {
    current.sixes = 0;
  }
  state.dice = null;
  if (state.players.length === 0) {
    state.turnUserId = null;
    state.turnDeadline = null;
    return;
  }
  const index = current ? state.players.indexOf(current) : -1;
  const next = state.players[(index + 1) % state.players.length];
  state.turnUserId = next.userId;
  state.turnDeadline = now + state.turnMs;
}

/** Keeps the same player on the clock for another roll. */
function keepTurn(state: LudoState, now: number): void {
  state.dice = null;
  state.turnDeadline = now + state.turnMs;
}

function finishGame(state: LudoState, winner: LudoPlayer): void {
  state.phase = 'finished';
  state.dice = null;
  state.turnUserId = null;
  state.turnDeadline = null;
  state.ready = [];
  state.lastResult = {
    winnerUserId: winner.userId,
    homeCounts: state.players.map((player) => ({
      userId: player.userId,
      home: homeCount(player),
    })),
  };
  state.players.forEach((player) => {
    player.sixes = 0;
  });
}

function requireTurn(state: LudoState, userId: number): LudoPlayer {
  if (state.phase !== 'playing') {
    throw new LudoError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new LudoError('You are not in this game');
  }
  if (state.turnUserId !== userId) {
    throw new LudoError('It is not your turn');
  }
  return player;
}

/** Rolls the dice for the player; returns the value that came up. */
export function rollLudo(
  state: LudoState,
  userId: number,
  now: number,
  forcedRoll?: number,
): number {
  const player = requireTurn(state, userId);
  if (state.dice != null) {
    throw new LudoError('Move a token before rolling again');
  }

  const value = forcedRoll ?? rollDie();
  if (!Number.isInteger(value) || value < 1 || value > 6) {
    throw new LudoError('Invalid dice roll');
  }
  state.lastRoll = value;

  if (value === 6) {
    player.sixes += 1;
    if (player.sixes >= 3) {
      player.lastAction = 'Three sixes — turn lost';
      player.sixes = 0;
      advanceTurn(state, now);
      return value;
    }
  } else {
    player.sixes = 0;
  }

  state.dice = value;
  player.lastAction = `Rolled ${value}`;

  if (movesFor(state, player).length === 0) {
    player.lastAction = `Rolled ${value} — no move`;
    advanceTurn(state, now);
    return value;
  }

  state.turnDeadline = now + state.turnMs;
  return value;
}

/** Moves one of the player's tokens to the pending roll. */
export function moveLudo(
  state: LudoState,
  userId: number,
  tokenId: number,
  now: number,
): void {
  const player = requireTurn(state, userId);
  if (state.dice == null) {
    throw new LudoError('Roll the dice first');
  }
  const dice = state.dice;
  const move = movesFor(state, player).find((c) => c.tokenId === tokenId);
  if (!move) {
    throw new LudoError('That token cannot move');
  }

  const token = player.tokens[tokenId];
  const captured = capturesAt(state, player, move.steps);
  token.steps = move.steps;

  let extraRoll = dice === 6;
  if (captured.length > 0) {
    let count = 0;
    for (const hit of captured) {
      for (const hitToken of hit.tokens) {
        hitToken.steps = -1;
        count += 1;
      }
    }
    extraRoll = true;
    player.lastAction =
      count === 1 ? 'Captured a token!' : `Captured ${count} tokens!`;
  } else if (move.steps >= LUDO_HOME_STEP) {
    player.lastAction = 'Token home!';
  } else if (move.steps === 0 && token.steps === 0 && dice === 6) {
    player.lastAction = 'Out of the base';
  } else {
    player.lastAction = `Moved ${dice}`;
  }

  if (player.tokens.every((held) => held.steps >= LUDO_HOME_STEP)) {
    finishGame(state, player);
    return;
  }

  if (extraRoll) {
    keepTurn(state, now);
  } else {
    advanceTurn(state, now);
  }
}

/**
 * Plays for whoever ran out of time: rolls when they still have to, or moves
 * their first legal token. Returns true when something was played.
 */
export function tickLudo(
  state: LudoState,
  now: number,
  random: () => number = Math.random,
): boolean {
  if (
    state.phase !== 'playing' ||
    state.turnDeadline == null ||
    now < state.turnDeadline
  ) {
    return false;
  }
  const player = findPlayer(state, state.turnUserId ?? -1);
  if (!player) {
    return false;
  }

  if (state.dice == null) {
    rollLudo(state, player.userId, now, rollDie(random));
    return true;
  }

  const moves = movesFor(state, player);
  if (moves.length === 0) {
    advanceTurn(state, now);
    return true;
  }
  moveLudo(state, player.userId, moves[0].tokenId, now);
  return true;
}

/** Removes a player who left the table mid-game. */
export function leaveLudo(
  state: LudoState,
  userId: number,
  now: number,
): void {
  state.ready = state.ready.filter((id) => id !== userId);
  state.players = state.players.filter((player) => player.userId !== userId);

  if (state.phase !== 'playing') {
    return;
  }
  if (state.players.length < 2) {
    // Not enough humans left to race: the game is over.
    state.phase = 'finished';
    state.dice = null;
    state.turnUserId = null;
    state.turnDeadline = null;
    const survivor = state.players[0];
    state.lastResult = survivor
      ? {
          winnerUserId: survivor.userId,
          homeCounts: [{ userId: survivor.userId, home: homeCount(survivor) }],
        }
      : null;
    return;
  }
  if (state.turnUserId === userId) {
    state.turnUserId = null;
    advanceTurn(state, now);
  }
}
