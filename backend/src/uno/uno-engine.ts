/**
 * Uno engine — pure functions over a serialisable state, exactly like the
 * poker and Ludo engines, so the tables service can persist mid-game state
 * in jsonb.
 *
 * Cards are compact codes: the colour (R, Y, G, B — or W for wild) followed
 * by the value (0–9, S = skip, R = reverse, D = draw two). The two wilds are
 * spelled `W` (wild) and `WF` (wild draw four), so `R5` is a red five, `GS`
 * a green skip and `BD` a blue draw two. A full deck is the official 108
 * cards.
 *
 * Rules implemented: play a card matching the active colour or the top
 * card's value; wilds always play and pick the next colour; a wild draw four
 * only when you hold no card of the active colour; skip, reverse (a skip in
 * heads-up), draw two and draw four take the next player's turn; you draw a
 * card when you cannot play and may play that drawn card immediately;
 * playing down to one card opens a short window in which the others can
 * catch you before you call UNO. Polling clients drive `tickUno`, which
 * plays for a player whose timer ran out — never a bot, only a stall of a
 * real person.
 */

export type UnoPhase = 'waiting' | 'playing' | 'finished';

/** Card colours; the wild "colour" is spelled `W` on the cards themselves. */
export type UnoColor = 'R' | 'Y' | 'G' | 'B';

export type UnoActionType =
  | 'play'
  | 'draw'
  | 'pass'
  | 'call_uno'
  | 'catch_uno'
  | 'challenge_wf4';

export interface UnoAction {
  type: UnoActionType;
  /** The card code to play, e.g. "R5" or "WF". */
  card?: string;
  /** The colour a wild card should take. */
  color?: UnoColor;
  /** For challenge_wf4: true = challenge (guilty), false = accept (innocent). */
  accept?: boolean;
}

export class UnoError extends Error {}

/** A card code, e.g. "R5", "GS", "BD", "W" or "WF". */
export type UnoCard = string;

export const UNO_COLORS: readonly UnoColor[] = ['R', 'Y', 'G', 'B'];
export const UNO_HAND_SIZE = 7;
export const UNO_MAX_PLAYERS = 6;
/** How long a player has to call UNO before the others lose their chance. */
export const UNO_CALL_MS = 15_000;
/** Cards the offender draws when caught before calling UNO. */
export const UNO_PENALTY = 2;

const VALUE_ORDER = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'S',
  'R',
  'D',
];

export function isUnoColor(value: unknown): value is UnoColor {
  return UNO_COLORS.includes(value as UnoColor);
}

/** The colour of a card; wilds answer `W`. */
export function cardColor(card: UnoCard): UnoColor | 'W' {
  return card.startsWith('W') ? 'W' : (card.charAt(0) as UnoColor);
}

/** The value of a card: 0–9, S, R, D — or W / F for the wilds. */
export function cardValue(card: UnoCard): string {
  return card.slice(1) || 'W';
}

export function isWild(card: UnoCard): boolean {
  return cardColor(card) === 'W';
}

/** The colour word used in action lines, e.g. `Red`. */
export function colorName(color: UnoColor): string {
  return { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' }[color];
}

/** A human name for a card, e.g. `Red 5`, `Green Skip`, `Wild Draw Four`. */
export function cardName(card: UnoCard): string {
  const value = cardValue(card);
  if (value === 'W') {
    return 'Wild';
  }
  if (value === 'F') {
    return 'Wild Draw Four';
  }
  const colour = colorName(cardColor(card) as UnoColor);
  if (value === 'S') {
    return `${colour} Skip`;
  }
  if (value === 'R') {
    return `${colour} Reverse`;
  }
  if (value === 'D') {
    return `${colour} Draw Two`;
  }
  return `${colour} ${value}`;
}

/** Score value used when a game ends: numbers face value, actions 20, wilds 50. */
export function cardPoints(card: UnoCard): number {
  const value = cardValue(card);
  if (value === 'W' || value === 'F') {
    return 50;
  }
  if (value === 'S' || value === 'R' || value === 'D') {
    return 20;
  }
  return Number(value);
}

/** The official 108-card deck: 25 per colour plus four of each wild. */
export function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const color of UNO_COLORS) {
    deck.push(`${color}0`);
    for (const value of VALUE_ORDER.slice(1)) {
      deck.push(`${color}${value}`, `${color}${value}`);
    }
  }
  for (let i = 0; i < 4; i += 1) {
    deck.push('W', 'WF');
  }
  return deck;
}

/** Fisher–Yates shuffle; a test hook can pass its own random source. */
export function shuffleDeck<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface UnoPlayer {
  userId: number;
  seatIndex: number;
  /** The cards this player holds; never leaves the server unmasked. */
  hand: UnoCard[];
  lastAction: string | null;
  /** This player has one card left and has called UNO. */
  saidUno: boolean;
}

export interface UnoResult {
  winnerUserId: number;
  /** Points scored from the cards still in the other hands. */
  points: number;
  remaining: { userId: number; cards: number }[];
}

export interface UnoPendingUno {
  userId: number;
  /** After this instant the player is safe — nobody caught them in time. */
  deadline: number;
}

export interface UnoState {
  phase: UnoPhase;
  gameNumber: number;
  /** How long a player has to act before the server plays for them. */
  turnMs: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** 1 = clockwise, -1 = counter-clockwise. */
  direction: 1 | -1;
  /** Server-only draw pile; the top card is the last element of the discard. */
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  /** The colour that must currently be matched (wilds set it). */
  activeColor: UnoColor;
  /** The card the current player just drew — only it may be played now. */
  drawnCard: UnoCard | null;
  /** A player with one card who has not called UNO yet. */
  pendingUno: UnoPendingUno | null;
  /** A WF4 that was just played and can be challenged. */
  pendingChallenge: { userId: number; card: UnoCard; color: UnoColor; victimId: number } | null;
  players: UnoPlayer[];
  ready: number[];
  lastResult: UnoResult | null;
  /** Running score for the match (first to 500 wins). */
  matchScores: Record<number, number>;
}

export interface UnoLegalActions {
  /** Cards the viewer may play right now; empty when it is not their turn. */
  playable: UnoCard[];
  /** The card the viewer just drew — only it may be played. */
  drawnCard: UnoCard | null;
  /** The viewer still has to draw this turn. */
  draw: boolean;
  /** The viewer drew a playable card and may pass instead of playing it. */
  pass: boolean;
  /** The viewer has one card left and can still call UNO. */
  callUno: boolean;
  /** Someone else has one card left without calling UNO — you can catch them. */
  catchUserId: number | null;
  /** A Wild Draw Four was just played and the viewer (victim) may challenge it. */
  challengeWf4: { offenderUserId: number; victimUserId: number } | null;
}

export interface UnoSeatInput {
  userId: number;
  seatIndex: number;
}

export interface StartUnoOptions {
  seats: UnoSeatInput[];
  turnMs: number;
  now: number;
  /** Test hook — skips the shuffle. */
  deck?: UnoCard[];
}

export function createUnoState(): UnoState {
  return {
    phase: 'waiting',
    gameNumber: 0,
    turnMs: 45_000,
    turnUserId: null,
    turnDeadline: null,
    direction: 1,
    drawPile: [],
    discardPile: [],
    activeColor: 'R',
    drawnCard: null,
    pendingUno: null,
    pendingChallenge: null,
    players: [],
    ready: [],
    lastResult: null,
    matchScores: {},
  };
}

export function isUnoPlaying(state: UnoState): boolean {
  return state.phase === 'playing';
}

/** The card everyone plays against — the top of the discard pile. */
export function topDiscard(state: UnoState): UnoCard | null {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}

function findPlayer(state: UnoState, userId: number): UnoPlayer | null {
  return state.players.find((player) => player.userId === userId) ?? null;
}

/**
 * Whether this card may be played on the current pile.
 * Plain wilds are always legal.
 * Wild Draw Four (WF) is ALWAYS playable per official rules, but if played
 * when the player holds a card of the active colour, it can be challenged.
 * The challenge is handled separately in playUnoCard.
 */
export function canPlayCard(
  state: UnoState,
  player: UnoPlayer,
  card: UnoCard,
): boolean {
  if (isWild(card)) {
    return true; // Both W and WF are always playable; WF challenge is a separate step
  }
  const top = topDiscard(state);
  return (
    cardColor(card) === state.activeColor ||
    (top != null && cardValue(card) === cardValue(top))
  );
}

/** Every card the player may play right now (after drawing: only that card). */
export function playableCards(state: UnoState, player: UnoPlayer): UnoCard[] {
  if (state.drawnCard != null) {
    return canPlayCard(state, player, state.drawnCard) ? [state.drawnCard] : [];
  }
  return player.hand.filter((card) => canPlayCard(state, player, card));
}

/**
 * What the viewer may do right now — null when no game is running or the
 * viewer is only seated. Catching and calling UNO work off-turn, so this is
 * not null just because somebody else is on the clock.
 */
export function legalUnoActions(
  state: UnoState,
  userId: number,
): UnoLegalActions | null {
  if (!isUnoPlaying(state)) {
    return null;
  }
  const player = findPlayer(state, userId);
  if (!player) {
    return null;
  }
  const myTurn = state.turnUserId === userId;
  return {
    playable: myTurn ? playableCards(state, player) : [],
    drawnCard: myTurn ? state.drawnCard : null,
    draw: myTurn && state.drawnCard == null,
    pass: myTurn && state.drawnCard != null,
    callUno: state.pendingUno?.userId === userId,
    catchUserId:
      state.pendingUno != null && state.pendingUno.userId !== userId
        ? state.pendingUno.userId
        : null,
    challengeWf4:
      state.pendingChallenge != null && state.pendingChallenge.victimId === userId
        ? { offenderUserId: state.pendingChallenge.userId, victimUserId: userId }
        : null,
  };
}

export function markUnoReady(state: UnoState, userId: number): void {
  if (state.phase === 'playing') {
    throw new UnoError('A game is already running');
  }
  if (!state.ready.includes(userId)) {
    state.ready.push(userId);
  }
}

export function everyoneUnoReady(
  state: UnoState,
  seatUserIds: number[],
): boolean {
  return (
    seatUserIds.length >= 2 &&
    seatUserIds.length <= UNO_MAX_PLAYERS &&
    seatUserIds.every((id) => state.ready.includes(id))
  );
}

/** Deals a fresh game to the given seats. */
export function startUno(state: UnoState, opts: StartUnoOptions): void {
  if (state.phase === 'playing') {
    throw new UnoError('A game is already running');
  }
  if (opts.seats.length < 2) {
    throw new UnoError('Uno needs at least two players');
  }
  if (opts.seats.length > UNO_MAX_PLAYERS) {
    throw new UnoError(`Uno supports at most ${UNO_MAX_PLAYERS} players`);
  }

  const seats = [...opts.seats].sort((a, b) => a.seatIndex - b.seatIndex);
  state.phase = 'playing';
  state.gameNumber += 1;
  state.turnMs = opts.turnMs;
  state.direction = 1;
  state.drawnCard = null;
  state.pendingUno = null;
  state.pendingChallenge = null;
  state.ready = [];
  state.lastResult = null;

  // Initialize match scores for new players
  for (const seat of seats) {
    if (!(seat.userId in state.matchScores)) {
      state.matchScores[seat.userId] = 0;
    }
  }

  state.drawPile = opts.deck ? [...opts.deck] : shuffleDeck(createUnoDeck());
  state.discardPile = [];

  const starterIndex = (state.gameNumber - 1) % seats.length;
  state.players = seats.map((seat) => ({
    userId: seat.userId,
    seatIndex: seat.seatIndex,
    hand: [],
    lastAction: null,
    saidUno: false,
  }));

  // Seven cards each, round-robin from the starter.
  for (let round = 0; round < UNO_HAND_SIZE; round += 1) {
    for (let offset = 0; offset < state.players.length; offset += 1) {
      const player =
        state.players[(starterIndex + offset) % state.players.length];
      player.hand.push(state.drawPile.shift() as UnoCard);
    }
  }

  // Flip the first card. Per official rules:
  // - Wild Draw Four (WF) is returned to the deck and another card is flipped
  // - Plain Wild (W) is playable: the first player chooses the starting colour
  // - Any other action card applies its effect to the first player
  let top = state.drawPile.shift() as UnoCard;
  let guard = 0;
  while (cardValue(top) === 'F' && guard < state.drawPile.length) {
    state.drawPile.push(top);
    top = state.drawPile.shift() as UnoCard;
    guard += 1;
  }
  state.discardPile = [top];
  if (isWild(top) && cardValue(top) === 'W') {
    // Plain wild: first player chooses colour. We leave activeColor as-is
    // (will be set when they play) but mark it specially.
    state.activeColor = 'R'; // placeholder; first player must play a wild or matching card
  } else {
    state.activeColor = isWild(top) ? 'R' : (cardColor(top) as UnoColor);
  }

  const starter = state.players[starterIndex];
  state.turnUserId = starter.userId;
  state.turnDeadline = opts.now + state.turnMs;
}

/** Draws up to `count` cards; refills from the discard pile when it runs dry. */
function drawCards(
  state: UnoState,
  player: UnoPlayer,
  count: number,
  random: () => number = Math.random,
): UnoCard[] {
  const drawn: UnoCard[] = [];
  for (let i = 0; i < count; i += 1) {
    if (state.drawPile.length === 0) {
      const top = topDiscard(state);
      const recycled = state.discardPile.slice(0, -1);
      if (recycled.length === 0) {
        break;
      }
      state.drawPile = shuffleDeck(recycled, random);
      state.discardPile = top == null ? [] : [top];
    }
    const card = state.drawPile.shift();
    if (card == null) {
      break;
    }
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

function requireTurn(state: UnoState, userId: number): UnoPlayer {
  if (!isUnoPlaying(state)) {
    throw new UnoError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new UnoError('You are not in this game');
  }
  if (state.turnUserId !== userId) {
    throw new UnoError('It is not your turn');
  }
  return player;
}

/** The player `steps` seats away in the current direction. */
function playerAt(state: UnoState, from: UnoPlayer, steps: number): UnoPlayer {
  const index = state.players.indexOf(from);
  const n = state.players.length;
  return state.players[(((index + state.direction * steps) % n) + n) % n];
}

/** Hands the turn to a player and restarts their clock. */
function setTurn(state: UnoState, player: UnoPlayer, now: number): void {
  // DO NOT clear pendingUno here - it should only clear when the next player ACTS
  // (plays a card, draws, passes, or challenges). The turn passing alone doesn't close it.
  state.turnUserId = player.userId;
  state.turnDeadline = now + state.turnMs;
  state.drawnCard = null;
}

/** Moves the turn one seat on (used when a turn simply ends). */
function advanceTurn(state: UnoState, now: number): void {
  const current = findPlayer(state, state.turnUserId ?? -1);
  if (!current) {
    const next = state.players[0];
    if (next) {
      setTurn(state, next, now);
    } else {
      state.turnUserId = null;
      state.turnDeadline = null;
      state.drawnCard = null;
    }
    return;
  }
  // Check if the player we're advancing to has a pending UNO that should be closed
  // UNO window closes when the NEXT player BEGINS their turn (i.e., when it's their turn to act)
  // So when we advance to a new player, we close any pending UNO for the previous player
  // Actually, the UNO window is for the player who went down to 1 card. It closes when
  // the next player acts (plays, draws, etc.). So we close it when the next player's turn starts.
  // This is handled by checking pendingUno in setTurn or here.
  setTurn(state, playerAt(state, current, 1), now);
}

function finishGame(state: UnoState, winner: UnoPlayer): void {
  state.phase = 'finished';
  state.turnUserId = null;
  state.turnDeadline = null;
  state.drawnCard = null;
  state.pendingUno = null;
  state.pendingChallenge = null;
  state.ready = [];
  winner.lastAction = 'Won the round!';

  const roundPoints = state.players
    .filter((player) => player.userId !== winner.userId)
    .reduce(
      (sum, player) =>
        sum + player.hand.reduce((total, card) => total + cardPoints(card), 0),
      0,
    );

  // Add to match score
  state.matchScores[winner.userId] = (state.matchScores[winner.userId] ?? 0) + roundPoints;

  // Check for match winner (500 points)
  const matchWinner = Object.entries(state.matchScores).find(
    ([, score]) => score >= 500,
  );
  if (matchWinner) {
    winner.lastAction = `Won the match with ${matchWinner[1]} points!`;
    state.phase = 'finished'; // match over
  }

  state.lastResult = {
    winnerUserId: winner.userId,
    points: roundPoints,
    remaining: state.players.map((player) => ({
      userId: player.userId,
      cards: player.hand.length,
    })),
  };
}

/** Plays one card: validates it, applies its effect and moves the turn on. */
export function playUnoCard(
  state: UnoState,
  userId: number,
  card: UnoCard | undefined,
  color: UnoColor | undefined,
  now: number,
): void {
  const player = requireTurn(state, userId);
  if (!card) {
    throw new UnoError('Pick a card to play');
  }
  if (!player.hand.includes(card)) {
    throw new UnoError('That card is not in your hand');
  }
  if (state.drawnCard != null && card !== state.drawnCard) {
    throw new UnoError('After drawing you may only play the card you drew');
  }
  if (!canPlayCard(state, player, card)) {
    throw new UnoError('That card does not match the pile');
  }
  if (isWild(card) && !isUnoColor(color)) {
    throw new UnoError('Pick a colour for the wild card');
  }

  // If this player acts and there's a pending UNO for someone else, close it
  if (state.pendingUno != null && state.pendingUno.userId !== userId) {
    state.pendingUno = null;
  }

  // Save the active color before potentially changing it (needed for WF4 challenge)
  const oldActiveColor = state.activeColor;

  // Remove exactly one copy — the deck holds two of most cards.
  player.hand.splice(player.hand.indexOf(card), 1);
  state.drawnCard = null;
  state.discardPile.push(card);

  if (isWild(card) && color != null) {
    state.activeColor = color;
    player.lastAction = `${cardName(card)} — ${colorName(color)}`;
  } else {
    state.activeColor = cardColor(card) as UnoColor;
    player.lastAction = `Played ${cardName(card)}`;
  }

  if (player.hand.length === 0) {
    finishGame(state, player);
    return;
  }
  if (player.hand.length === 1) {
    // The UNO window opens: call it, or the others can catch you.
    player.saidUno = false;
    // UNO window lasts until the next player BEGINS their turn (acts).
    state.pendingUno = { userId: player.userId, deadline: Infinity };
  }

  const value = cardValue(card);
  if (value === 'S') {
    const skipped = playerAt(state, player, 1);
    skipped.lastAction = 'Skipped';
    setTurn(state, playerAt(state, player, 2), now);
  } else if (value === 'R') {
    state.direction = state.direction === 1 ? -1 : 1;
    // Heads-up a reverse acts as a skip: the player goes again.
    const steps = state.players.length === 2 ? 2 : 1;
    setTurn(state, playerAt(state, player, steps), now);
  } else if (value === 'D') {
    const victim = playerAt(state, player, 1);
    drawCards(state, victim, 2);
    victim.lastAction = 'Drew 2 — skipped';
    // Check if victim now has 1 card (UNO window for them)
    if (victim.hand.length === 1) {
      victim.saidUno = false;
      state.pendingUno = { userId: victim.userId, deadline: Infinity };
    }
    setTurn(state, playerAt(state, player, 2), now);
  } else if (value === 'F') {
    // Wild Draw Four: always playable, but can be challenged if player
    // held a card of the active colour (BEFORE this card was played).
    // The VICTIM (next player) decides.
    const victim = playerAt(state, player, 1);
    const hadMatchingColor = player.hand.some(
      (held) => cardColor(held) === oldActiveColor,
    );
    if (hadMatchingColor) {
      // Open a challenge window for the victim
      state.pendingChallenge = {
        userId: player.userId,
        card,
        color: oldActiveColor,
        victimId: victim.userId,
      };
      victim.lastAction = 'Challenged — draw 4 or accept?';
      // Turn stays with victim to decide
      state.turnUserId = victim.userId;
      state.turnDeadline = now + state.turnMs;
    } else {
      // No matching color: cannot be challenged, apply effect immediately
      drawCards(state, victim, 4);
      victim.lastAction = 'Drew 4 — skipped';
      if (victim.hand.length === 1) {
        victim.saidUno = false;
        state.pendingUno = { userId: victim.userId, deadline: Infinity };
      }
      setTurn(state, playerAt(state, player, 2), now);
    }
  } else {
    advanceTurn(state, now);
  }
}

/** Draws one card. A playable draw keeps the turn and may be played at once. */
export function drawUno(
  state: UnoState,
  userId: number,
  now: number,
  random: () => number = Math.random,
): void {
  const player = requireTurn(state, userId);
  if (state.drawnCard != null) {
    throw new UnoError('You already drew this turn');
  }

  // If this player acts and there's a pending UNO for someone else, close it
  if (state.pendingUno != null && state.pendingUno.userId !== userId) {
    state.pendingUno = null;
  }

  const drawn = drawCards(state, player, 1, random)[0];
  if (drawn == null) {
    throw new UnoError('The draw pile is empty');
  }
  // Drawing back above one card retires any UNO call on this player.
  player.saidUno = false;
  if (state.pendingUno?.userId === userId) {
    state.pendingUno = null;
  }

  if (canPlayCard(state, player, drawn)) {
    state.drawnCard = drawn;
    state.turnDeadline = now + state.turnMs;
    player.lastAction = 'Drew a card — may play it';
  } else {
    player.lastAction = 'Drew a card — no play';
    advanceTurn(state, now);
  }
}

/** Gives up after a playable draw — the turn moves on. */
export function passUno(state: UnoState, userId: number, now: number): void {
  const player = requireTurn(state, userId);
  if (state.drawnCard == null) {
    throw new UnoError('Draw a card first');
  }

  // If this player acts and there's a pending UNO for someone else, close it
  if (state.pendingUno != null && state.pendingUno.userId !== userId) {
    state.pendingUno = null;
  }

  player.lastAction = 'Passed';
  advanceTurn(state, now);
}

/** Calls UNO on your own one-card hand — the catch window closes. */
export function callUno(state: UnoState, userId: number): void {
  if (!isUnoPlaying(state)) {
    throw new UnoError('No game is in progress');
  }
  const player = findPlayer(state, userId);
  if (!player) {
    throw new UnoError('You are not in this game');
  }
  if (state.pendingUno?.userId !== userId) {
    throw new UnoError('You have nothing to call');
  }
  player.saidUno = true;
  player.lastAction = 'UNO!';
  state.pendingUno = null;
}

/** Catches a player who reached one card without calling UNO. */
export function catchUno(state: UnoState, userId: number, now: number): void {
  if (!isUnoPlaying(state)) {
    throw new UnoError('No game is in progress');
  }
  const catcher = findPlayer(state, userId);
  if (!catcher) {
    throw new UnoError('You are not in this game');
  }
  const pending = state.pendingUno;
  if (pending == null) {
    throw new UnoError('Nobody is on the hook');
  }
  if (pending.userId === userId) {
    throw new UnoError('You cannot catch yourself');
  }
  // With turn-based UNO window, deadline is Infinity - check if it's the catcher's turn
  // Actually, the window closes when the next player BEGINS their turn (i.e., acts)
  // This is handled by the catcher being able to catch before they act.
  // We allow catch at any time before the next player acts.

  const offender = findPlayer(state, pending.userId);
  if (offender) {
    drawCards(state, offender, UNO_PENALTY);
    offender.saidUno = false;
    offender.lastAction = `Caught without UNO — drew ${UNO_PENALTY}`;
  }
  catcher.lastAction = 'Caught a missing UNO';
  state.pendingUno = null;
}

/** Challenges a Wild Draw Four played illegally. */
export function challengeWf4(
  state: UnoState,
  userId: number,
  accept: boolean,
  now: number,
): void {
  if (!isUnoPlaying(state)) {
    throw new UnoError('No game is in progress');
  }
  const challenger = findPlayer(state, userId);
  if (!challenger) {
    throw new UnoError('You are not in this game');
  }
  const pending = state.pendingChallenge;
  if (pending == null) {
    throw new UnoError('No Wild Draw Four to challenge');
  }
  if (pending.victimId !== userId) {
    throw new UnoError('Only the next player may challenge');
  }

  // If this player acts and there's a pending UNO for someone else, close it
  if (state.pendingUno != null && state.pendingUno.userId !== userId) {
    state.pendingUno = null;
  }

  const offender = findPlayer(state, pending.userId);
  if (!offender) {
    state.pendingChallenge = null;
    throw new UnoError('Offender no longer in game');
  }

  if (accept) {
    // Challenger accepts the WF4 - draws 4 and loses turn
    drawCards(state, challenger, 4);
    challenger.lastAction = 'Accepted WF4 — drew 4';
    // Check UNO for challenger
    if (challenger.hand.length === 1) {
      challenger.saidUno = false;
      state.pendingUno = { userId: challenger.userId, deadline: Infinity };
    }
    state.pendingChallenge = null;
    // Turn passes to player after challenger
    setTurn(state, playerAt(state, challenger, 1), now);
  } else {
    // Challenger challenges: offender must show hand
    // If offender had matching color (guilty), offender draws 4
    // If offender had NO matching color (innocent), challenger draws 6
    const hadMatchingColor = offender.hand.some(
      (held) => cardColor(held) === pending.color,
    );
    if (hadMatchingColor) {
      // Guilty: offender draws 4
      drawCards(state, offender, 4);
      offender.lastAction = 'Challenged WF4 — guilty, drew 4';
      challenger.lastAction = 'Caught illegal WF4';
    } else {
      // Innocent: challenger draws 6
      drawCards(state, challenger, 6);
      challenger.lastAction = 'Wrong challenge — drew 6';
      if (challenger.hand.length === 1) {
        challenger.saidUno = false;
        state.pendingChallenge = null;
        state.pendingUno = { userId: challenger.userId, deadline: Infinity };
      }
    }
    state.pendingChallenge = null;
    // Turn passes to player after challenger
    setTurn(state, playerAt(state, challenger, 1), now);
  }
}

/** Applies a player action; throws UnoError when the action is illegal. */
export function applyUnoAction(
  state: UnoState,
  userId: number,
  action: UnoAction,
  now: number,
  random: () => number = Math.random,
): void {
  switch (action.type) {
    case 'play':
      playUnoCard(state, userId, action.card, action.color, now);
      return;
    case 'draw':
      drawUno(state, userId, now, random);
      return;
    case 'pass':
      passUno(state, userId, now);
      return;
    case 'call_uno':
      callUno(state, userId);
      return;
    case 'catch_uno':
      catchUno(state, userId, now);
      return;
    case 'challenge_wf4':
      if (action.accept == null) {
        throw new UnoError('Must specify accept=true or accept=false');
      }
      challengeWf4(state, userId, action.accept, now);
      return;
    default:
      throw new UnoError('Unknown action');
  }
}

/** The colour a player holds most of — used when the server picks for a wild. */
function bestColor(player: UnoPlayer): UnoColor {
  const counts = new Map<UnoColor, number>();
  for (const card of player.hand) {
    const color = cardColor(card);
    if (color !== 'W') {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  let best: UnoColor = 'R';
  let bestCount = -1;
  for (const color of UNO_COLORS) {
    const count = counts.get(color) ?? 0;
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Plays for whoever ran out of time: plays their first legal card (picking
 * the colour they hold most of for wilds) or draws one. Also closes a UNO
 * window whose deadline has passed. Returns true when something happened.
 */
export function tickUno(
  state: UnoState,
  now: number,
  random: () => number = Math.random,
): boolean {
  if (state.phase !== 'playing') {
    return false;
  }
  let acted = false;

  // Handle pending challenge timeout (auto-accept after timeout)
  if (state.pendingChallenge != null) {
    const victim = findPlayer(state, state.pendingChallenge.victimId);
    if (victim && state.turnUserId === victim.userId && state.turnDeadline != null && now >= state.turnDeadline) {
      // Auto-accept the WF4
      drawCards(state, victim, 4);
      victim.lastAction = 'Timed out — accepted WF4, drew 4';
      if (victim.hand.length === 1) {
        victim.saidUno = false;
        state.pendingUno = { userId: victim.userId, deadline: Infinity };
      }
      state.pendingChallenge = null;
      setTurn(state, playerAt(state, victim, 1), now);
      return true;
    }
  }

  // Nobody caught them in time — the one-card hand is safe.
  // With turn-based UNO window, deadline is Infinity - handled in setTurn
  // But keep this for backward compatibility
  if (state.pendingUno != null && state.pendingUno.deadline !== Infinity && now >= state.pendingUno.deadline) {
    state.pendingUno = null;
    acted = true;
  }

  if (state.turnDeadline == null || now < state.turnDeadline) {
    return acted;
  }
  const player = findPlayer(state, state.turnUserId ?? -1);
  if (!player) {
    advanceTurn(state, now);
    return true;
  }

  const color = bestColor(player);
  if (state.drawnCard != null) {
    if (canPlayCard(state, player, state.drawnCard)) {
      playUnoCard(
        state,
        player.userId,
        state.drawnCard,
        isWild(state.drawnCard) ? color : undefined,
        now,
      );
    } else {
      passUno(state, player.userId, now);
    }
    return true;
  }

  const playable = playableCards(state, player);
  if (playable.length > 0) {
    const card = playable[0];
    playUnoCard(state, player.userId, card, isWild(card) ? color : undefined, now);
    return true;
  }

  drawUno(state, player.userId, now, random);
  // If the draw was playable, play it straight away so the table never
  // waits out two clocks for one decision.
  if (state.drawnCard != null) {
    playUnoCard(
      state,
      player.userId,
      state.drawnCard,
      isWild(state.drawnCard) ? color : undefined,
      now,
    );
  }
  return true;
}

/** Removes a player who left the table mid-game. */
export function leaveUno(state: UnoState, userId: number, now: number): void {
  state.ready = state.ready.filter((id) => id !== userId);
  delete state.matchScores[userId];
  const leaverIndex = state.players.findIndex(
    (player) => player.userId === userId,
  );
  state.players = state.players.filter((player) => player.userId !== userId);

  if (state.phase !== 'playing') {
    return;
  }
  if (state.pendingUno?.userId === userId) {
    state.pendingUno = null;
  }
  if (state.pendingChallenge?.userId === userId || state.pendingChallenge?.victimId === userId) {
    state.pendingChallenge = null;
  }
  if (state.players.length < 2) {
    // Not enough humans left to play: the game is over.
    state.phase = 'finished';
    state.turnUserId = null;
    state.turnDeadline = null;
    state.drawnCard = null;
    state.pendingChallenge = null;
    const survivor = state.players[0];
    state.lastResult = survivor
      ? {
          winnerUserId: survivor.userId,
          points: 0,
          remaining: [{ userId: survivor.userId, cards: survivor.hand.length }],
        }
      : null;
    return;
  }
  if (state.turnUserId === userId) {
    const next = state.players[leaverIndex % state.players.length];
    setTurn(state, next, now);
  }
}
