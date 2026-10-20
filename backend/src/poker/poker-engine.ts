import { createDeck, shuffle, type Card } from './cards.js';
import {
  compareHands,
  evaluateHand,
  type HandValue,
} from './hand-evaluator.js';

export type Phase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river';

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';

export interface PlayerAction {
  type: ActionType;
  amount?: number;
}

export interface EnginePlayer {
  userId: number;
  seatIndex: number;
  /** Chips behind. */
  stack: number;
  /** Chips committed on the current street. */
  bet: number;
  /** Chips committed during the whole hand (for side pots). */
  committed: number;
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last aggressive action on this street. */
  acted: boolean;
  hole: Card[];
  /** Hole cards are shown to everyone (showdown). */
  revealed: boolean;
  lastAction: string | null;
}

export interface WinnerInfo {
  userId: number;
  amount: number;
  hand: string | null;
}

/** One pot of a hand: the main pot, or a side pot cut off by an all-in. */
export interface Pot {
  /** Chips in this pot. */
  amount: number;
  /** True for the main pot — the first one. */
  main: boolean;
  /** The contribution level that opens this pot; 0 for the main pot. */
  level: number;
  /** The players who can still win this pot. */
  eligibleUserIds: number[];
}

/** How a pot was settled: who took it and how much of it each took. */
export interface PotAward {
  amount: number;
  main: boolean;
  winners: WinnerInfo[];
}

export interface HandResult {
  handNumber: number;
  winners: WinnerInfo[];
  /** The pots of the hand and who won each of them. */
  pots: PotAward[];
}

export interface GameState {
  phase: Phase;
  handNumber: number;
  dealerSeat: number | null;
  /** Seats that posted the blinds — kept on show until the next hand. */
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  smallBlind: number;
  bigBlind: number;
  turnMs: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  currentBet: number;
  lastRaiseSize: number;
  /**
   * The bet level the current street opened at: the posted blinds before the
   * flop, zero on every later street. A bet above this level can be uncalled
   * (nobody could match it) and goes back to the bettor — the blinds
   * themselves are a matched pair and never are.
   */
  streetBase: number;
  community: Card[];
  /** Server-only remainder of the shuffled deck. */
  deck: Card[];
  players: EnginePlayer[];
  ready: number[];
  lastResult: HandResult | null;
}

export interface LegalActions {
  fold: boolean;
  check: boolean;
  /** Chips needed to call; null when there is nothing to call. */
  callAmount: number | null;
  /** The call uses the whole stack — the player is all-in after it. */
  callAllIn: boolean;
  /** Allowed street-bet totals when raising; null when raising is impossible. */
  raise: { min: number; max: number } | null;
  /** An all-in raise is possible (more chips than a plain call needs). */
  allIn: boolean;
}

export interface StartHandOptions {
  seats: { userId: number; seatIndex: number }[];
  smallBlind: number;
  bigBlind: number;
  /** Chips for players who join or bust out between hands. */
  buyIn: number;
  turnMs: number;
  now: number;
  /** Test hook — skips the shuffle. */
  deck?: Card[];
}

export class PokerError extends Error {}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function createState(): GameState {
  return {
    phase: 'waiting',
    handNumber: 0,
    dealerSeat: null,
    smallBlindSeat: null,
    bigBlindSeat: null,
    smallBlind: 0,
    bigBlind: 0,
    turnMs: 60_000,
    turnUserId: null,
    turnDeadline: null,
    currentBet: 0,
    lastRaiseSize: 0,
    streetBase: 0,
    community: [],
    deck: [],
    players: [],
    ready: [],
    lastResult: null,
  };
}

/** Fills in fields a hand saved by an older version of the engine is missing. */
export function normalizeState(state: GameState): void {
  if (typeof state.streetBase !== 'number') {
    state.streetBase = state.phase === 'preflop' ? state.bigBlind : 0;
  }
}

export function isBettingPhase(state: GameState): boolean {
  return state.phase !== 'waiting';
}

export function potTotal(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.committed, 0);
}

/**
 * The pots of the hand: the main pot plus every side pot.
 *
 * Chips sit in layers. Everybody who is still in the hand puts the same
 * amount into the bottom layer; the next layer holds what the deeper stacks
 * put in above the first all-in, and so on. A layer can only be won by the
 * players who paid into it and are still in the hand — an all-in caps the pot
 * that player can win, and everything above it becomes a side pot for the
 * players who stayed in. Layers the same players can win are merged into a
 * single pot, so a hand without a real side pot shows one pot.
 */
export function potsFor(state: GameState): Pot[] {
  const contributors = state.players.filter((p) => p.committed > 0);
  if (contributors.length === 0) {
    return [];
  }
  const levels = [...new Set(contributors.map((p) => p.committed))].sort(
    (a, b) => a - b,
  );
  const pots: Pot[] = [];
  let lower = 0;
  let open: Pot | null = null;
  for (const level of levels) {
    const amount = contributors.reduce(
      (sum, p) =>
        sum +
        Math.min(p.committed, level) -
        Math.min(p.committed, lower),
      0,
    );
    const level0 = lower;
    lower = level;
    if (amount <= 0) {
      continue;
    }
    // The players who paid into this layer and are still in the hand.
    const eligible = state.players
      .filter((p) => !p.folded && effectiveCommitment(state, p) >= level)
      .map((p) => p.userId);
    if (open && samePlayers(open.eligibleUserIds, eligible)) {
      open.amount += amount;
      continue;
    }
    open = {
      amount,
      main: pots.length === 0,
      level: level0,
      eligibleUserIds: eligible,
    };
    pots.push(open);
  }
  return pots;
}

/**
 * What a player is in for: their chips in the pot plus, while they still can
 * act, what they would have to add to stay in. A player who has not called
 * the current bet yet can still win the whole pot with it.
 */
function effectiveCommitment(state: GameState, player: EnginePlayer): number {
  if (player.folded || player.allIn) {
    return player.committed;
  }
  return Math.max(player.committed, state.currentBet);
}

function samePlayers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const set = new Set(a);
  return b.every((userId) => set.has(userId));
}

/** Deals a fresh hand to the given seats and posts the blinds. */
export function startHand(state: GameState, opts: StartHandOptions): void {
  const seats = [...opts.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  if (seats.length < 2) {
    throw new PokerError('At least two players are needed to deal a hand');
  }
  if (isBettingPhase(state)) {
    throw new PokerError('A hand is already in progress');
  }

  state.deck = opts.deck ? [...opts.deck] : shuffle(createDeck());
  state.players = seats.map((seat) => {
    const previous = state.players.find((p) => p.userId === seat.userId);
    const stack = previous && previous.stack > 0 ? previous.stack : opts.buyIn;
    return {
      userId: seat.userId,
      seatIndex: seat.seatIndex,
      stack,
      bet: 0,
      committed: 0,
      folded: false,
      allIn: false,
      acted: false,
      hole: [],
      revealed: false,
      lastAction: null,
    };
  });
  state.community = [];
  state.lastResult = null;
  state.ready = [];
  state.handNumber += 1;
  state.smallBlind = opts.smallBlind;
  state.bigBlind = opts.bigBlind;
  state.turnMs = opts.turnMs;

  // Move the button to the next occupied seat (first seat for the first hand).
  const dealer =
    state.dealerSeat == null
      ? seats[0].seatIndex
      : (nextOccupant(state, state.dealerSeat)?.seatIndex ??
        seats[0].seatIndex);
  state.dealerSeat = dealer;

  const afterDealer = orderedPlayers(state, dealer);
  const dealerPlayer = state.players.find((p) => p.seatIndex === dealer) as EnginePlayer;
  // Heads-up: the button posts the small blind. Else: first seat after the button.
  const smallBlindPlayer =
    seats.length === 2 ? dealerPlayer : afterDealer[0];
  const bigBlindPlayer =
    seats.length === 2 ? afterDealer[0] : afterDealer[1];
  if (!smallBlindPlayer || !bigBlindPlayer) {
    throw new PokerError('Not enough players to post blinds');
  }
  state.smallBlindSeat = smallBlindPlayer.seatIndex;
  state.bigBlindSeat = bigBlindPlayer.seatIndex;

  // Two cards each, one at a time, starting with the small blind.
  const dealOrder = orderedPlayers(state, smallBlindPlayer.seatIndex, true);
  for (let round = 0; round < 2; round += 1) {
    for (const p of dealOrder) {
      p.hole.push(state.deck.shift() as Card);
    }
  }

  postBlind(state, smallBlindPlayer, opts.smallBlind, 'Small blind');
  postBlind(state, bigBlindPlayer, opts.bigBlind, 'Big blind');
  // The bet is the full big blind even when the player in the blind could
  // not cover it — everyone else still has to call the whole amount.
  state.currentBet = Math.max(
    opts.bigBlind,
    smallBlindPlayer.bet,
    bigBlindPlayer.bet,
  );
  // The level that is really on the table: a bet above it can be uncalled,
  // the blinds themselves never are.
  state.streetBase = Math.max(smallBlindPlayer.bet, bigBlindPlayer.bet);
  state.lastRaiseSize = opts.bigBlind;

  state.phase = 'preflop';
  const firstToAct = nextOccupant(
    state,
    bigBlindPlayer.seatIndex,
    (p) => !p.folded && !p.allIn && p.stack > 0,
  );
  state.turnUserId = firstToAct?.userId ?? null;
  state.turnDeadline = firstToAct ? opts.now + opts.turnMs : null;
  if (!firstToAct) {
    // Everyone is all-in from the blinds — run the board out.
    runOutBoard(state);
    settleShowdown(state);
  }
}

export function markReady(state: GameState, userId: number): void {
  if (!state.ready.includes(userId)) {
    state.ready.push(userId);
  }
}

export function everyoneReady(state: GameState, seatUserIds: number[]): boolean {
  return (
    seatUserIds.length >= 2 &&
    seatUserIds.every((id) => state.ready.includes(id))
  );
}

/** Applies a player action; throws PokerError when the action is illegal. */
export function applyAction(
  state: GameState,
  userId: number,
  action: PlayerAction,
  now: number,
): void {
  if (!isBettingPhase(state)) {
    throw new PokerError('No hand is in progress');
  }
  if (state.turnUserId !== userId) {
    throw new PokerError('It is not your turn');
  }
  const player = state.players.find((p) => p.userId === userId);
  if (!player || player.folded || player.allIn) {
    throw new PokerError('You cannot act right now');
  }

  switch (action.type) {
    case 'fold': {
      player.folded = true;
      player.acted = true;
      player.lastAction = 'Folded';
      break;
    }
    case 'check': {
      if (player.bet !== state.currentBet) {
        throw new PokerError('There is a bet to call — checking is not possible');
      }
      player.acted = true;
      player.lastAction = 'Checked';
      break;
    }
    case 'call': {
      const need = state.currentBet - player.bet;
      if (need <= 0) {
        throw new PokerError('There is nothing to call');
      }
      commitChips(player, need);
      player.acted = true;
      player.lastAction = player.allIn
        ? 'All-in'
        : `Called ${formatMoney(need)}`;
      break;
    }
    case 'raise': {
      applyRaise(state, player, action.amount);
      break;
    }
    case 'allin': {
      const maxTo = player.bet + player.stack;
      if (maxTo > state.currentBet) {
        applyRaise(state, player, maxTo);
      } else {
        commitChips(player, state.currentBet - player.bet);
        player.acted = true;
        player.lastAction = 'All-in';
      }
      break;
    }
    default:
      throw new PokerError('Unknown action');
  }

  afterAction(state, player, now);
}

/** Folds a player out of turn (they left the table). */
export function forceFold(state: GameState, userId: number, now: number): void {
  const player = state.players.find((p) => p.userId === userId);
  if (!player || player.folded || !isBettingPhase(state)) {
    return;
  }
  const wasTurn = state.turnUserId === userId;
  player.folded = true;
  player.acted = true;
  player.lastAction = 'Left';

  const active = state.players.filter((p) => !p.folded);
  if (active.length === 1) {
    awardFoldWin(state, active[0]);
    return;
  }
  if (roundComplete(state)) {
    state.turnUserId = null;
    state.turnDeadline = null;
    advanceStreet(state, now);
    return;
  }
  if (wasTurn) {
    const next = nextOccupant(state, player.seatIndex, (p) =>
      needsToAct(p, state),
    );
    state.turnUserId = next?.userId ?? null;
    state.turnDeadline = next ? now + state.turnMs : null;
    if (!next) {
      advanceStreet(state, now);
    }
  }
}

/** Auto-plays turns whose deadline has passed (check when possible, else fold). */
export function tickTimeouts(state: GameState, now: number): void {
  let guard = 0;
  while (
    isBettingPhase(state) &&
    state.turnUserId != null &&
    state.turnDeadline != null &&
    now >= state.turnDeadline &&
    guard < 100
  ) {
    guard += 1;
    const player = state.players.find((p) => p.userId === state.turnUserId);
    if (!player) {
      state.turnUserId = null;
      state.turnDeadline = null;
      break;
    }
    const legal = legalActionsFor(state, player);
    if (legal?.check) {
      applyAction(state, player.userId, { type: 'check' }, now);
    } else {
      applyAction(state, player.userId, { type: 'fold' }, now);
    }
  }
}

export function legalActionsFor(
  state: GameState,
  player: EnginePlayer,
): LegalActions | null {
  if (!isBettingPhase(state) || state.turnUserId !== player.userId) {
    return null;
  }
  if (player.folded || player.allIn || player.stack <= 0) {
    return null;
  }
  const need = state.currentBet - player.bet;
  const maxTo = player.bet + player.stack;
  const check = need <= 0;
  const callAmount = need > 0 ? Math.min(need, player.stack) : null;
  const callAllIn = need > 0 && player.stack <= need;
  const canRaise = mayRaise(player);
  let raise: { min: number; max: number } | null = null;
  if (canRaise && maxTo > state.currentBet) {
    const fullMin =
      state.currentBet === 0
        ? state.bigBlind
        : state.currentBet + state.lastRaiseSize;
    raise = { min: Math.min(fullMin, maxTo), max: maxTo };
  }
  return {
    fold: true,
    check,
    callAmount,
    callAllIn,
    raise,
    // An all-in that is only a call is always allowed; one that is a raise
    // needs the betting to be open.
    allIn: maxTo > state.currentBet ? canRaise : true,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function applyRaise(
  state: GameState,
  player: EnginePlayer,
  amountRaw: number | undefined,
): void {
  const amount = amountRaw ?? 0;
  if (!Number.isInteger(amount)) {
    throw new PokerError('Enter a whole amount');
  }
  const maxTo = player.bet + player.stack;
  if (amount > maxTo) {
    throw new PokerError('You do not have that many chips');
  }
  if (amount <= state.currentBet) {
    throw new PokerError('A raise must be higher than the current bet');
  }
  if (!mayRaise(player)) {
    throw new PokerError(
      'A short all-in does not reopen the betting — call or fold',
    );
  }
  const isAllIn = amount === maxTo;
  const fullMin =
    state.currentBet === 0
      ? Math.min(state.bigBlind, maxTo)
      : state.currentBet + state.lastRaiseSize;
  if (!isAllIn && amount < fullMin) {
    const label = state.currentBet === 0 ? 'bet' : 'raise';
    throw new PokerError(
      `The minimum ${label} is ${formatMoney(fullMin)}`,
    );
  }

  const increment = amount - state.currentBet;
  const wasBet = state.currentBet === 0;
  commitChips(player, amount - player.bet);
  if (increment >= state.lastRaiseSize) {
    // A full raise: the minimum raise grows with it and the betting is
    // reopened for everybody who has already acted.
    state.lastRaiseSize = increment;
    for (const other of state.players) {
      if (other.userId !== player.userId && !other.folded && !other.allIn) {
        other.acted = false;
      }
    }
  }
  // A short all-in raise is not a real raise: it lifts the bet but leaves
  // the minimum raise and the players who may raise where they were.
  state.currentBet = amount;
  player.acted = true;
  player.lastAction = isAllIn
    ? 'All-in'
    : wasBet
      ? `Bet ${formatMoney(amount)}`
      : `Raised to ${formatMoney(amount)}`;
}

/**
 * Whether this player may raise the bet.
 *
 * A short all-in raise — one that is smaller than the last full raise —
 * does not reopen the betting: a player who has already acted may only call
 * or fold (the full bet rule). A full raise clears that flag again, so
 * everybody is back in.
 */
function mayRaise(player: EnginePlayer): boolean {
  return !player.acted;
}

function afterAction(
  state: GameState,
  actor: EnginePlayer,
  now: number,
): void {
  const active = state.players.filter((p) => !p.folded);
  if (active.length === 1) {
    awardFoldWin(state, active[0]);
    return;
  }
  if (roundComplete(state)) {
    state.turnUserId = null;
    state.turnDeadline = null;
    advanceStreet(state, now);
    return;
  }
  const next = nextOccupant(state, actor.seatIndex, (p) =>
    needsToAct(p, state),
  );
  if (!next) {
    state.turnUserId = null;
    state.turnDeadline = null;
    advanceStreet(state, now);
    return;
  }
  state.turnUserId = next.userId;
  state.turnDeadline = now + state.turnMs;
}

function roundComplete(state: GameState): boolean {
  return state.players
    .filter((p) => !p.folded && !p.allIn)
    .every((p) => p.acted && p.bet === state.currentBet);
}

function needsToAct(player: EnginePlayer, state: GameState): boolean {
  return (
    !player.folded &&
    !player.allIn &&
    !(player.acted && player.bet === state.currentBet)
  );
}

function commitChips(player: EnginePlayer, amount: number): number {
  const paid = Math.max(0, Math.min(amount, player.stack));
  player.stack -= paid;
  player.bet += paid;
  player.committed += paid;
  if (player.stack === 0) {
    player.allIn = true;
  }
  return paid;
}

function postBlind(
  state: GameState,
  player: EnginePlayer,
  amount: number,
  label: string,
): void {
  const paid = commitChips(player, amount);
  player.lastAction = `${label} ${formatMoney(paid)}`;
}

function advanceStreet(state: GameState, now: number): void {
  // Whatever nobody could match goes back to the bettor before the street is
  // cleared — the pot is what was really contested.
  returnUncalledBet(state);
  for (const p of state.players) {
    p.bet = 0;
    p.acted = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.bigBlind;
  state.streetBase = 0;

  switch (state.phase) {
    case 'preflop':
      dealTo(state, 3, 'flop');
      break;
    case 'flop':
      dealTo(state, 1, 'turn');
      break;
    case 'turn':
      dealTo(state, 1, 'river');
      break;
    case 'river':
      settleShowdown(state);
      return;
    default:
      return;
  }

  const active = state.players.filter((p) => !p.folded);
  if (active.length === 1) {
    awardFoldWin(state, active[0]);
    return;
  }
  const contenders = active.filter((p) => !p.allIn && p.stack > 0);
  if (contenders.length < 2) {
    // No more betting is possible — put the remaining cards out.
    runOutBoard(state);
    settleShowdown(state);
    return;
  }
  const first = nextOccupant(
    state,
    state.dealerSeat ?? -1,
    (p) => !p.folded && !p.allIn && p.stack > 0,
  );
  state.turnUserId = first?.userId ?? null;
  state.turnDeadline = first ? now + state.turnMs : null;
  if (!first) {
    runOutBoard(state);
    settleShowdown(state);
  }
}

function dealTo(state: GameState, count: number, phase: Phase): void {
  state.deck.shift();
  for (let i = 0; i < count; i += 1) {
    state.community.push(state.deck.shift() as Card);
  }
  state.phase = phase;
}

/** Deals all remaining community cards (used when everyone is all-in). */
function runOutBoard(state: GameState): void {
  while (state.community.length < 5) {
    state.deck.shift();
    const count = state.community.length === 0 ? 3 : 1;
    for (let i = 0; i < count; i += 1) {
      state.community.push(state.deck.shift() as Card);
    }
    state.phase =
      state.community.length === 3
        ? 'flop'
        : state.community.length === 4
          ? 'turn'
          : 'river';
  }
}

function awardFoldWin(state: GameState, winner: EnginePlayer): void {
  returnUncalledBet(state);
  const pot = potTotal(state);
  finishHand(
    state,
    new Map([[winner.userId, pot]]),
    null,
    [
      {
        amount: pot,
        main: true,
        winners: [{ userId: winner.userId, amount: pot, hand: null }],
      },
    ],
  );
}

function settleShowdown(state: GameState): void {
  returnUncalledBet(state);
  const active = state.players.filter((p) => !p.folded);
  const values = new Map<number, HandValue>();
  for (const p of active) {
    values.set(p.userId, evaluateHand([...p.hole, ...state.community]));
  }

  const awards = new Map<number, number>();
  const hands = new Map<number, HandValue>();
  const potAwards: PotAward[] = [];

  // Every pot is settled on its own: the main pot and each side pot go to
  // the best hand among the players who could win them.
  for (const pot of potsFor(state)) {
    const eligible = active.filter((p) => pot.eligibleUserIds.includes(p.userId));
    if (eligible.length === 0) {
      continue;
    }
    let winners = [eligible[0]];
    for (const p of eligible.slice(1)) {
      const diff = compareHands(
        values.get(p.userId) as HandValue,
        values.get(winners[0].userId) as HandValue,
      );
      if (diff > 0) {
        winners = [p];
      } else if (diff === 0) {
        winners.push(p);
      }
    }
    // Odd cents go to the first winners clockwise from the button.
    const ordered = orderFromSeat(state, winners, state.dealerSeat ?? -1);
    const share = Math.floor(pot.amount / ordered.length);
    let remainder = pot.amount - share * ordered.length;
    const potWinners: WinnerInfo[] = [];
    for (const p of ordered) {
      const amount = share + (remainder > 0 ? 1 : 0);
      remainder = Math.max(0, remainder - 1);
      awards.set(p.userId, (awards.get(p.userId) ?? 0) + amount);
      if (!hands.has(p.userId)) {
        hands.set(p.userId, values.get(p.userId) as HandValue);
      }
      potWinners.push({
        userId: p.userId,
        amount,
        hand: (values.get(p.userId) as HandValue).name,
      });
    }
    potAwards.push({ amount: pot.amount, main: pot.main, winners: potWinners });
  }

  finishHand(state, awards, hands, potAwards);
}

/**
 * The part of the last bet that nobody could match goes back to the player
 * who made it.
 *
 * A bet is only matched up to the level the street opened at — the posted
 * blinds before the flop — so the blinds are never uncalled, and only what a
 * player put in above that level can be handed back. A folded player's chips
 * stay in the pot: they are dead money for everybody else.
 */
function returnUncalledBet(state: GameState): void {
  const ranked = [...state.players]
    .filter((p) => p.bet > 0)
    .sort((a, b) => b.bet - a.bet);
  const top = ranked[0];
  if (!top || top.folded) {
    return;
  }
  const matched = ranked[1]?.bet ?? 0;
  const base = state.streetBase ?? 0;
  const uncalled = Math.max(
    0,
    top.bet - base - Math.max(0, matched - base),
  );
  if (uncalled <= 0) {
    return;
  }
  top.stack += uncalled;
  top.bet -= uncalled;
  top.committed -= uncalled;
}

function finishHand(
  state: GameState,
  awards: Map<number, number>,
  hands: Map<number, HandValue> | null,
  pots: PotAward[],
): void {
  const winners: WinnerInfo[] = [];
  for (const [userId, amount] of awards) {
    const player = state.players.find((p) => p.userId === userId);
    if (!player) {
      continue;
    }
    player.stack += amount;
    winners.push({ userId, amount, hand: hands?.get(userId)?.name ?? null });
  }
  winners.sort((a, b) => b.amount - a.amount);

  state.lastResult = { handNumber: state.handNumber, winners, pots };
  state.phase = 'waiting';
  state.turnUserId = null;
  state.turnDeadline = null;
  state.ready = [];
  // The button and blind seats stay put between hands (where the last hand
  // left them) so players can still see who posted what while they ready up
  // for the next one; startHand moves them on.
  for (const p of state.players) {
    p.bet = 0;
    p.committed = 0;
    if (hands && !p.folded) {
      p.revealed = true;
    }
  }
}

/** Players in seat order, starting just after (or at) the given seat. */
function orderedPlayers(
  state: GameState,
  fromSeatIndex: number,
  includeFrom = false,
): EnginePlayer[] {
  const sorted = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  const after = sorted.filter((p) => p.seatIndex > fromSeatIndex);
  const upTo = sorted.filter((p) => p.seatIndex <= fromSeatIndex);
  if (includeFrom) {
    const last = upTo.slice(-1);
    return [...last, ...after, ...upTo.slice(0, -1)];
  }
  return [...after, ...upTo];
}

function orderFromSeat(
  state: GameState,
  players: EnginePlayer[],
  seatIndex: number,
): EnginePlayer[] {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  return [
    ...sorted.filter((p) => p.seatIndex > seatIndex),
    ...sorted.filter((p) => p.seatIndex <= seatIndex),
  ];
}

function nextOccupant(
  state: GameState,
  fromSeatIndex: number,
  predicate: (player: EnginePlayer) => boolean = () => true,
): EnginePlayer | null {
  return orderedPlayers(state, fromSeatIndex).find(predicate) ?? null;
}
