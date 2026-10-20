/**
 * Dominoes engine — pure functions over a serialisable state, exactly like the
 * poker and Ludo engines, so the tables service can persist a round in jsonb.
 *
 * Rules implemented (draw dominoes, double-six set):
 *   - 2, 3 or 4 players get 7 tiles each; the rest is the boneyard.
 *   - The player holding the highest double starts (highest tile if no double
 *     was dealt). They may open with any tile.
 *   - A tile must match the open pip on either end of the chain. When a tile
 *     is played on an end, its matching half faces the chain.
 *   - No legal tile? Draw one from the boneyard and try again. Once the
 *     boneyard is empty a player with no move must pass. In a three-player
 *     game the boneyard is never drawn from at all — a player with no legal
 *     tile simply passes, so the seven leftover tiles stay face down.
 *   - The first player to empty their hand wins. If every player passes in a
 *     row (a blocked round), the fewest pips left wins; ties share the win.
 *
 * Polling clients drive `tickDominoes`, which plays for whoever ran out of
 * time — never a bot, only a stall of a real person.
 */

export type DominoesPhase = 'waiting' | 'playing' | 'finished';

/** Which end of the chain a tile is played on. */
export type DominoesEnd = 'left' | 'right' | 'start';

export interface DominoesTile {
  id: number;
  a: number;
  b: number;
}

export class DominoesError extends Error {}

export const DOMINOES_MIN_PLAYERS = 2;
export const DOMINOES_MAX_PLAYERS = 4;
export const DOMINOES_MAX_PIPS = 6;
export const DOMINOES_HAND_SIZE = 7;
export const DOMINOES_HAND_SIZE_MANY = 5;

/** Every tile of a double-six set, in a stable id order (0..27). */
export const DOMINOES_TILES: readonly DominoesTile[] = (() => {
  const tiles: DominoesTile[] = [];
  for (let a = 0; a <= DOMINOES_MAX_PIPS; a += 1) {
    for (let b = a; b <= DOMINOES_MAX_PIPS; b += 1) {
      tiles.push({ id: tiles.length, a, b });
    }
  }
  return tiles;
})();

const TILES_BY_ID = new Map(DOMINOES_TILES.map((tile) => [tile.id, tile]));

export function dominoesTile(id: number): DominoesTile {
  const tile = TILES_BY_ID.get(id);
  if (!tile) {
    throw new DominoesError('That tile is not in the set');
  }
  return tile;
}

export function isDouble(tile: DominoesTile): boolean {
  return tile.a === tile.b;
}

export function dominoesPips(hand: readonly number[]): number {
  return hand.reduce((sum, id) => {
    const tile = TILES_BY_ID.get(id);
    return sum + (tile ? tile.a + tile.b : 0);
  }, 0);
}

export interface DominoesPlayer {
  userId: number;
  seatIndex: number;
  /** Tile ids still in this player's hand — never leaves the server. */
  hand: number[];
  lastAction: string | null;
}

/** One tile as it sits in the chain, oriented left half to right half. */
export interface DominoesChainTile {
  tileId: number;
  left: number;
  right: number;
}

export interface DominoesScore {
  userId: number;
  pips: number;
}

export interface DominoesResult {
  reason: 'hand' | 'blocked' | 'forfeit';
  /** One winner, or several when a blocked round is tied on pips. */
  winnerUserIds: number[];
  scores: DominoesScore[];
}

export interface DominoesState {
  phase: DominoesPhase;
  gameNumber: number;
  /** How long a player has to play before the server plays for them. */
  turnMs: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  players: DominoesPlayer[];
  chain: DominoesChainTile[];
  /** Tile ids still face down in the boneyard. */
  boneyard: number[];
  ready: number[];
  /** Consecutive passes with no play — a full lap blocks the round. */
  passes: number;
  lastResult: DominoesResult | null;
}

export interface DominoesMove {
  tileId: number;
  end: DominoesEnd;
}

export interface DominoesLegalActions {
  moves: DominoesMove[];
  /** No tile fits and the boneyard still has tiles. */
  draw: boolean;
  /** No tile fits and the boneyard is empty. */
  pass: boolean;
}

export interface DominoesSeatInput {
  userId: number;
  seatIndex: number;
}

export interface StartDominoesOptions {
  seats: DominoesSeatInput[];
  turnMs: number;
  now: number;
  /** Injectable shuffle source, so tests can deal a known table. */
  random?: () => number;
}

export function createDominoesState(): DominoesState {
  return {
    phase: 'waiting',
    gameNumber: 0,
    turnMs: 45_000,
    turnUserId: null,
    turnDeadline: null,
    players: [],
    chain: [],
    boneyard: [],
    ready: [],
    passes: 0,
    lastResult: null,
  };
}

export function isDominoesPlaying(state: DominoesState): boolean {
  return state.phase === 'playing';
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const deck = [...items];
  for (let index = deck.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
  return deck;
}

function findPlayer(
  state: DominoesState,
  userId: number,
): DominoesPlayer | null {
  return state.players.find((player) => player.userId === userId) ?? null;
}

/** The player who opens the round: highest double, else highest tile. */
function findStarter(players: readonly DominoesPlayer[]): DominoesPlayer {
  const holders = new Map<number, DominoesPlayer>();
  for (const player of players) {
    for (const id of player.hand) {
      const tile = TILES_BY_ID.get(id);
      if (tile && isDouble(tile)) {
        holders.set(tile.a, player);
      }
    }
  }
  for (let pip = DOMINOES_MAX_PIPS; pip >= 0; pip -= 1) {
    const holder = holders.get(pip);
    if (holder) {
      return holder;
    }
  }

  // No double was dealt — the highest tile opens instead.
  let best: DominoesPlayer = players[0];
  let bestTile: DominoesTile | null = null;
  for (const player of players) {
    for (const id of player.hand) {
      const tile = TILES_BY_ID.get(id);
      if (!tile) continue;
      const better =
        bestTile == null ||
        tile.a + tile.b > bestTile.a + bestTile.b ||
        (tile.a + tile.b === bestTile.a + bestTile.b &&
          Math.max(tile.a, tile.b) > Math.max(bestTile.a, bestTile.b));
      if (better) {
        best = player;
        bestTile = tile;
      }
    }
  }
  return best;
}

export function startDominoes(
  state: DominoesState,
  opts: StartDominoesOptions,
): void {
  if (state.phase === 'playing') {
    throw new DominoesError('A game is already running');
  }
  if (opts.seats.length < DOMINOES_MIN_PLAYERS) {
    throw new DominoesError('Dominoes needs at least two players');
  }
  if (opts.seats.length > DOMINOES_MAX_PLAYERS) {
    throw new DominoesError('Dominoes supports at most four players');
  }

  const seats = [...opts.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  // Every player is dealt seven tiles, whatever the table size — the
  // boneyard absorbs the rest (seven of them in a three-player game).
  const handSize = DOMINOES_HAND_SIZE;
  const deck = shuffle(
    DOMINOES_TILES.map((tile) => tile.id),
    opts.random ?? Math.random,
  );

  state.phase = 'playing';
  state.gameNumber += 1;
  state.turnMs = opts.turnMs;
  state.chain = [];
  state.ready = [];
  state.passes = 0;
  state.lastResult = null;
  state.players = seats.map((seat) => ({
    userId: seat.userId,
    seatIndex: seat.seatIndex,
    hand: deck.splice(0, handSize),
    lastAction: null,
  }));
  state.boneyard = deck;

  const starter = findStarter(state.players);
  state.turnUserId = starter.userId;
  state.turnDeadline = opts.now + state.turnMs;
}

/** The nearest player after `index` in seat order (wrapping around). */
function nextPlayer(
  state: DominoesState,
  index: number,
): DominoesPlayer | null {
  if (state.players.length === 0) {
    return null;
  }
  return state.players[(index + 1) % state.players.length] ?? null;
}

function advanceTurn(state: DominoesState, now: number): void {
  if (state.phase !== 'playing') {
    return;
  }
  const currentIndex = state.players.findIndex(
    (player) => player.userId === state.turnUserId,
  );
  const next = nextPlayer(state, currentIndex);
  state.turnUserId = next?.userId ?? null;
  state.turnDeadline = next ? now + state.turnMs : null;
}

function openEnds(state: DominoesState): {
  left: number | null;
  right: number | null;
} {
  const first = state.chain[0];
  const last = state.chain[state.chain.length - 1];
  return {
    left: first?.left ?? null,
    right: last?.right ?? null,
  };
}

/**
 * Every legal placement for this player's hand. A tile can fit both ends when
 * both open pips match it — those are two genuinely different moves.
 */
export function movesForDominoes(
  state: DominoesState,
  player: DominoesPlayer,
): DominoesMove[] {
  if (state.chain.length === 0) {
    return player.hand.map((tileId) => ({ tileId, end: 'start' as const }));
  }

  const { left, right } = openEnds(state);
  const moves: DominoesMove[] = [];
  for (const tileId of player.hand) {
    const tile = TILES_BY_ID.get(tileId);
    if (!tile) continue;
    const fitsLeft = tile.a === left || tile.b === left;
    const fitsRight = tile.a === right || tile.b === right;
    if (fitsLeft) {
      moves.push({ tileId, end: 'left' });
    }
    // When both ends carry the same pip, playing either side leaves the same
    // two open values; one choice is enough and avoids a pointless button.
    if (fitsRight && !(left === right && fitsLeft)) {
      moves.push({ tileId, end: 'right' });
    }
  }
  return moves;
}

export function legalDominoesActions(
  state: DominoesState,
  userId: number,
): DominoesLegalActions | null {
  if (state.phase !== 'playing' || state.turnUserId !== userId) {
    return null;
  }
  const player = findPlayer(state, userId);
  if (!player) {
    return null;
  }
  const moves = movesForDominoes(state, player);
  // In a three-player game nobody draws from the boneyard — a player with no
  // legal tile simply passes, so the boneyard is never touched.
  const threePlayer = state.players.length === 3;
  const canDraw =
    !threePlayer && moves.length === 0 && state.boneyard.length > 0;
  return {
    moves,
    draw: canDraw,
    pass: moves.length === 0 && (threePlayer || state.boneyard.length === 0),
  };
}

export function markDominoesReady(
  state: DominoesState,
  userId: number,
): void {
  if (state.phase === 'playing') {
    throw new DominoesError('A game is already running');
  }
  if (!state.ready.includes(userId)) {
    state.ready.push(userId);
  }
}

export function everyoneDominoesReady(
  state: DominoesState,
  seatUserIds: number[],
): boolean {
  return (
    seatUserIds.length >= DOMINOES_MIN_PLAYERS &&
    seatUserIds.length <= DOMINOES_MAX_PLAYERS &&
    seatUserIds.every((id) => state.ready.includes(id))
  );
}

function finishHand(
  state: DominoesState,
  winner: DominoesPlayer,
): void {
  state.phase = 'finished';
  state.turnUserId = null;
  state.turnDeadline = null;
  state.ready = [];
  state.passes = 0;
  state.lastResult = {
    reason: 'hand',
    winnerUserIds: [winner.userId],
    scores: state.players.map((player) => ({
      userId: player.userId,
      pips: player.userId === winner.userId ? 0 : dominoesPips(player.hand),
    })),
  };
}

function finishBlocked(state: DominoesState): void {
  const scores = state.players.map((player) => ({
    userId: player.userId,
    pips: dominoesPips(player.hand),
  }));
  const lowest = Math.min(...scores.map((score) => score.pips));
  state.phase = 'finished';
  state.turnUserId = null;
  state.turnDeadline = null;
  state.ready = [];
  state.passes = 0;
  state.lastResult = {
    reason: 'blocked',
    winnerUserIds: scores
      .filter((score) => score.pips === lowest)
      .map((score) => score.userId),
    scores,
  };
}

function requireTurn(state: DominoesState, userId: number): DominoesPlayer {
  if (state.phase !== 'playing') {
    throw new DominoesError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new DominoesError('You are not in this game');
  }
  if (state.turnUserId !== userId) {
    throw new DominoesError('It is not your turn');
  }
  return player;
}

function placeTile(
  state: DominoesState,
  tile: DominoesTile,
  end: DominoesEnd,
): void {
  if (end === 'start' || state.chain.length === 0) {
    state.chain.push({ tileId: tile.id, left: tile.a, right: tile.b });
    return;
  }

  const { left, right } = openEnds(state);
  if (end === 'left') {
    // The matching half must face the chain, so it becomes the right half.
    const entry =
      tile.b === left
        ? { tileId: tile.id, left: tile.a, right: tile.b }
        : { tileId: tile.id, left: tile.b, right: tile.a };
    state.chain.unshift(entry);
    return;
  }

  const entry =
    tile.a === right
      ? { tileId: tile.id, left: tile.a, right: tile.b }
      : { tileId: tile.id, left: tile.b, right: tile.a };
  state.chain.push(entry);
}

/** Plays a tile from the player's hand and passes the turn on. */
export function playDominoes(
  state: DominoesState,
  userId: number,
  tileId: number,
  end: DominoesEnd | undefined,
  now: number,
): DominoesMove {
  const player = requireTurn(state, userId);
  const moves = movesForDominoes(state, player);
  const move =
    moves.find(
      (candidate) =>
        candidate.tileId === tileId &&
        (end == null || candidate.end === end),
    ) ?? null;
  if (!move) {
    throw new DominoesError('That tile does not fit either end');
  }

  const tile = dominoesTile(tileId);
  const handIndex = player.hand.indexOf(tileId);
  player.hand.splice(handIndex, 1);
  placeTile(state, tile, move.end);
  player.lastAction = `Played ${tile.a}–${tile.b}`;
  state.passes = 0;

  if (player.hand.length === 0) {
    finishHand(state, player);
    return move;
  }

  advanceTurn(state, now);
  return move;
}

/**
 * Draws one tile. Only legal when the player has no playable tile and the
 * boneyard still has tiles; the turn stays with them to play or draw again.
 */
export function drawDominoes(
  state: DominoesState,
  userId: number,
  now: number,
): DominoesTile {
  const player = requireTurn(state, userId);
  if (movesForDominoes(state, player).length > 0) {
    throw new DominoesError('Play a tile before drawing');
  }
  // Three-player tables never draw — the boneyard is out of play.
  if (state.players.length === 3) {
    throw new DominoesError('No draws in a three-player game — pass');
  }
  const tileId = state.boneyard.shift();
  if (tileId == null) {
    throw new DominoesError('The boneyard is empty — pass');
  }

  const tile = dominoesTile(tileId);
  player.hand.push(tileId);
  player.lastAction = 'Drew a tile';
  state.passes = 0;
  state.turnDeadline = now + state.turnMs;
  return tile;
}

/** Passes a turn that has no playable tile and no draw left. */
export function passDominoes(
  state: DominoesState,
  userId: number,
  now: number,
): void {
  const player = requireTurn(state, userId);
  if (movesForDominoes(state, player).length > 0) {
    throw new DominoesError('You have a tile that fits — play it');
  }
  // In a three-player game the boneyard is never drawn from, so it never
  // blocks a pass.
  if (state.boneyard.length > 0 && state.players.length !== 3) {
    throw new DominoesError('Draw from the boneyard before passing');
  }

  player.lastAction = 'Passed';
  state.passes += 1;

  // A full lap with no tile played is a blocked round.
  if (state.passes >= state.players.length) {
    finishBlocked(state);
    return;
  }
  advanceTurn(state, now);
}

/**
 * Plays for whoever ran out of time: play a tile if one fits, otherwise draw
 * until something fits (or the boneyard empties), then pass. Returns true when
 * something was played.
 */
export function tickDominoes(
  state: DominoesState,
  now: number,
  // Kept in the signature for symmetry with the other engines; the boneyard
  // is shuffled when the round starts, so a timeout has nothing random to do.
  _random: () => number = Math.random,
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

  while (state.phase === 'playing' && state.turnUserId === player.userId) {
    const moves = movesForDominoes(state, player);
    if (moves.length > 0) {
      playDominoes(state, player.userId, moves[0].tileId, moves[0].end, now);
      return true;
    }
    if (state.boneyard.length === 0) {
      passDominoes(state, player.userId, now);
      return true;
    }
    // Three-player tables never draw — a stalled player passes.
    if (state.players.length === 3) {
      passDominoes(state, player.userId, now);
      return true;
    }
    drawDominoes(state, player.userId, now);
  }
  return true;
}

/** Removes a player who left the table mid-round. */
export function leaveDominoes(
  state: DominoesState,
  userId: number,
  now: number,
): void {
  state.ready = state.ready.filter((id) => id !== userId);

  const index = state.players.findIndex((player) => player.userId === userId);
  if (index < 0) {
    return;
  }
  const wasTurn = state.turnUserId === userId;
  const next = nextPlayer(state, index);
  state.players.splice(index, 1);

  if (state.phase !== 'playing') {
    return;
  }

  if (state.players.length < DOMINOES_MIN_PLAYERS) {
    const survivor = state.players[0];
    state.phase = 'finished';
    state.turnUserId = null;
    state.turnDeadline = null;
    state.ready = [];
    state.lastResult = survivor
      ? {
          reason: 'forfeit',
          winnerUserIds: [survivor.userId],
          scores: [
            { userId: survivor.userId, pips: dominoesPips(survivor.hand) },
          ],
        }
      : null;
    return;
  }

  if (wasTurn) {
    state.turnUserId = next?.userId ?? state.players[0]?.userId ?? null;
    state.turnDeadline =
      state.turnUserId == null ? null : now + state.turnMs;
    state.passes = 0;
  }
}
