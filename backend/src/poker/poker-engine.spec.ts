import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createState,
  everyoneReady,
  legalActionsFor,
  markReady,
  PokerError,
  potsFor,
  startHand,
  tickTimeouts,
  type EnginePlayer,
  type GameState,
} from './poker-engine.js';

const SB = 100;
const BB = 200;
const BUY_IN = 10_000;
const TURN_MS = 60_000;

function seats(...userIds: number[]) {
  return userIds.map((userId, seatIndex) => ({ userId, seatIndex }));
}

function game(count = 2, deck?: string[]): GameState {
  const state = createState();
  startHand(state, {
    seats: seats(...Array.from({ length: count }, (_, i) => i + 1)),
    smallBlind: SB,
    bigBlind: BB,
    buyIn: BUY_IN,
    turnMs: TURN_MS,
    now: 1_000,
    deck,
  });
  return state;
}

/** A hand with the given stacks — player 1 sits on the button. */
function gameWithStacks(stacks: number[], deck?: string[]): GameState {
  const state = createState();
  state.handNumber = 1;
  state.players = stacks.map((stack, index) =>
    presetPlayer(index + 1, index, stack),
  );
  startHand(state, {
    seats: seats(...stacks.map((_, index) => index + 1)),
    smallBlind: SB,
    bigBlind: BB,
    buyIn: BUY_IN,
    turnMs: TURN_MS,
    now: 1_000,
    deck,
  });
  return state;
}

function player(state: GameState, userId: number): EnginePlayer {
  const found = state.players.find((p) => p.userId === userId);
  if (!found) {
    throw new Error(`no player ${userId}`);
  }
  return found;
}

function totalChips(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.stack + p.committed, 0);
}

function presetPlayer(
  userId: number,
  seatIndex: number,
  stack: number,
): EnginePlayer {
  return {
    userId,
    seatIndex,
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
}

describe('startHand', () => {
  it('posts blinds, deals two cards each and gives the button first action heads-up', () => {
    const state = game(2, [
      'Ah',
      '2c',
      'Kh',
      '8d',
      'X1',
      '3c',
      '4d',
      '9s',
      'X2',
      '6c',
      'X3',
      '7d',
    ]);
    expect(state.phase).toBe('preflop');
    expect(player(state, 1).bet).toBe(SB); // the button posts the small blind
    expect(player(state, 2).bet).toBe(BB);
    expect(state.smallBlindSeat).toBe(0); // ...which is seat 0 heads-up
    expect(state.bigBlindSeat).toBe(1);
    expect(state.currentBet).toBe(BB);
    expect(state.turnUserId).toBe(1);
    expect(player(state, 1).hole).toEqual(['Ah', 'Kh']);
    expect(player(state, 2).hole).toEqual(['2c', '8d']);
    expect(totalChips(state)).toBe(2 * BUY_IN);
  });

  it('posts blinds around a three-handed table and starts action after the big blind', () => {
    const state = game(3);
    expect(player(state, 1).bet).toBe(0); // dealer
    expect(player(state, 2).bet).toBe(SB);
    expect(player(state, 3).bet).toBe(BB);
    expect(state.dealerSeat).toBe(0);
    expect(state.smallBlindSeat).toBe(1);
    expect(state.bigBlindSeat).toBe(2);
    expect(state.turnUserId).toBe(1);

    applyAction(state, 1, { type: 'fold' }, 2_000);
    applyAction(state, 2, { type: 'fold' }, 2_000);
    expect(state.phase).toBe('waiting');
    expect(state.lastResult?.winners).toEqual([
      { userId: 3, amount: 300, hand: null },
    ]);
    expect(player(state, 3).stack).toBe(BUY_IN + SB);
    expect(totalChips(state)).toBe(3 * BUY_IN);
    // ...and they stay on show while everyone readies up for the next hand...
    expect(state.smallBlindSeat).toBe(1);
    expect(state.bigBlindSeat).toBe(2);
  });

  it('moves the button and the blinds on the next hand', () => {
    const state = game(3);
    expect([state.dealerSeat, state.smallBlindSeat, state.bigBlindSeat]).toEqual([
      0, 1, 2,
    ]);

    applyAction(state, 1, { type: 'fold' }, 2_000);
    applyAction(state, 2, { type: 'fold' }, 2_000);
    for (const userId of [1, 2, 3]) {
      markReady(state, userId);
    }
    expect(everyoneReady(state, [1, 2, 3])).toBe(true);

    startHand(state, {
      seats: seats(1, 2, 3),
      smallBlind: SB,
      bigBlind: BB,
      buyIn: BUY_IN,
      turnMs: TURN_MS,
      now: 2_000,
    });
    // ...until the next hand deals and moves them with the button.
    expect([state.dealerSeat, state.smallBlindSeat, state.bigBlindSeat]).toEqual([
      1, 2, 0,
    ]);
    expect(player(state, 3).bet).toBe(SB);
    expect(player(state, 1).bet).toBe(BB);
  });
});

describe('betting rounds', () => {
  it('runs the board out street by street and settles at showdown', () => {
    const state = game(2, [
      'Ah',
      '2c',
      'Kh',
      '8d',
      'X1',
      '3c',
      '4d',
      '9s',
      'X2',
      '6c',
      'X3',
      '7d',
    ]);

    applyAction(state, 1, { type: 'call' }, 2_000);
    expect(player(state, 1).bet).toBe(BB);
    expect(state.turnUserId).toBe(2); // big blind still gets the option
    applyAction(state, 2, { type: 'check' }, 2_000);

    expect(state.phase).toBe('flop');
    expect(state.community).toEqual(['3c', '4d', '9s']);
    expect(state.turnUserId).toBe(2); // first seat after the button

    applyAction(state, 2, { type: 'check' }, 3_000);
    applyAction(state, 1, { type: 'check' }, 3_000);
    expect(state.phase).toBe('turn');
    expect(state.community).toEqual(['3c', '4d', '9s', '6c']);

    applyAction(state, 2, { type: 'check' }, 4_000);
    applyAction(state, 1, { type: 'check' }, 4_000);
    expect(state.phase).toBe('river');
    expect(state.community).toEqual(['3c', '4d', '9s', '6c', '7d']);

    applyAction(state, 2, { type: 'check' }, 5_000);
    applyAction(state, 1, { type: 'check' }, 5_000);

    expect(state.phase).toBe('waiting');
    expect(state.lastResult?.winners).toEqual([
      { userId: 1, amount: 400, hand: 'High card' },
    ]);
    expect(player(state, 1).stack).toBe(BUY_IN + BB);
    expect(player(state, 2).stack).toBe(BUY_IN - BB);
    expect(player(state, 1).revealed).toBe(true);
    expect(player(state, 2).revealed).toBe(true);
    expect(totalChips(state)).toBe(2 * BUY_IN);
  });

  it('enforces minimum raises and tracks the last raise size', () => {
    const state = game();
    expect(() =>
      applyAction(state, 1, { type: 'raise', amount: 300 }, 2_000),
    ).toThrow(PokerError);
    applyAction(state, 1, { type: 'raise', amount: 400 }, 2_000);
    expect(state.currentBet).toBe(400);
    expect(state.turnUserId).toBe(2);

    expect(() =>
      applyAction(state, 2, { type: 'raise', amount: 500 }, 2_000),
    ).toThrow(PokerError);
    applyAction(state, 2, { type: 'raise', amount: 600 }, 2_000);
    expect(state.currentBet).toBe(600);
    expect(state.turnUserId).toBe(1);
    expect(player(state, 1).bet).toBe(400);
  });

  it('lets a short all-in raise in and runs the board out afterwards', () => {
    const state = game();
    applyAction(state, 1, { type: 'raise', amount: 400 }, 2_000);
    applyAction(state, 2, { type: 'raise', amount: 600 }, 2_000);
    applyAction(state, 1, { type: 'allin' }, 2_000);
    applyAction(state, 2, { type: 'allin' }, 2_000);
    expect(state.phase).toBe('waiting');
    expect(state.community).toHaveLength(5);
    expect(totalChips(state)).toBe(2 * BUY_IN);
  });
});

describe('folds', () => {
  it('awards the whole pot when the other player folds', () => {
    const state = game();
    applyAction(state, 1, { type: 'fold' }, 2_000);
    expect(state.phase).toBe('waiting');
    expect(state.lastResult?.winners).toEqual([
      { userId: 2, amount: 300, hand: null },
    ]);
    expect(player(state, 1).stack).toBe(BUY_IN - SB);
    expect(player(state, 2).stack).toBe(BUY_IN + SB);
    expect(totalChips(state)).toBe(2 * BUY_IN);
  });
});

describe('all-ins and side pots', () => {
  it('splits the main and side pots between the best eligible hands', () => {
    const state = createState();
    state.handNumber = 1;
    state.players = [
      presetPlayer(1, 0, 3_000),
      presetPlayer(2, 1, 4_000),
      presetPlayer(3, 2, 10_000),
    ];
    startHand(state, {
      seats: seats(1, 2, 3),
      smallBlind: SB,
      bigBlind: BB,
      buyIn: BUY_IN,
      turnMs: TURN_MS,
      now: 1_000,
      deck: [
        'Jh',
        'Ks',
        'As',
        'Th',
        'Kd',
        'Ad',
        'X1',
        '9c',
        '8d',
        '5s',
        'X2',
        '3c',
        'X3',
        '2d',
      ],
    });
    // Seat 0 is the button, seats 1/2 post the blinds, seat 0 acts first.
    expect(state.turnUserId).toBe(1);
    expect(player(state, 1).hole).toEqual(['As', 'Ad']);
    expect(player(state, 2).hole).toEqual(['Jh', 'Th']);
    expect(player(state, 3).hole).toEqual(['Ks', 'Kd']);

    applyAction(state, 1, { type: 'allin' }, 2_000);
    applyAction(state, 2, { type: 'allin' }, 2_000);
    applyAction(state, 3, { type: 'call' }, 2_000);

    expect(state.phase).toBe('waiting');
    expect(state.community).toEqual(['9c', '8d', '5s', '3c', '2d']);
    expect(player(state, 1).stack).toBe(9_000); // aces take the 9 000 main pot
    expect(player(state, 2).stack).toBe(0);
    expect(player(state, 3).stack).toBe(8_000); // kings take the 2 000 side pot
    expect(state.lastResult?.winners).toEqual([
      { userId: 1, amount: 9_000, hand: 'Pair' },
      { userId: 3, amount: 2_000, hand: 'Pair' },
    ]);
    expect(totalChips(state)).toBe(17_000);
  });

  it('shows the main pot and every side pot with the players who can win them', () => {
    const state = gameWithStacks(
      [3_000, 4_000, 10_000],
      [
        'Jh',
        'Ks',
        'As',
        'Th',
        'Kd',
        'Ad',
        'X1',
        '9c',
        '8d',
        '5s',
        'X2',
        '3c',
        'X3',
        '2d',
      ],
    );
    // The blinds are in the pot — one pot everybody can still win.
    expect(potsFor(state)).toEqual([
      { amount: 300, main: true, level: 0, eligibleUserIds: [1, 2, 3] },
    ]);

    applyAction(state, 1, { type: 'allin' }, 2_000);
    applyAction(state, 2, { type: 'allin' }, 2_000);
    applyAction(state, 3, { type: 'call' }, 2_000);

    // Player 1 is all-in for 3 000, so the main pot holds 3 000 from every
    // player and the side pot the 1 000 each of the two deeper stacks put in
    // above it. Only the two deeper stacks can win the side pot.
    expect(state.lastResult?.pots).toEqual([
      {
        amount: 9_000,
        main: true,
        winners: [{ userId: 1, amount: 9_000, hand: 'Pair' }],
      },
      {
        amount: 2_000,
        main: false,
        winners: [{ userId: 3, amount: 2_000, hand: 'Pair' }],
      },
    ]);
  });

  it('cuts a side pot off as soon as an all-in caps the main pot', () => {
    const state = gameWithStacks([1_000, 10_000, 10_000]);
    // The button is all-in for 1 000, the small blind calls and the big
    // blind raises to 3 000: the 2 000 above the all-in is a side pot the
    // two players who stayed in can win.
    applyAction(state, 1, { type: 'allin' }, 2_000);
    applyAction(state, 2, { type: 'call' }, 2_000);
    applyAction(state, 3, { type: 'raise', amount: 3_000 }, 2_000);
    expect(potsFor(state)).toEqual([
      { amount: 3_000, main: true, level: 0, eligibleUserIds: [1, 2, 3] },
      { amount: 2_000, main: false, level: 1_000, eligibleUserIds: [2, 3] },
    ]);
  });

  it('keeps one pot when every player can win all of it', () => {
    const state = game(3);
    applyAction(state, 1, { type: 'call' }, 2_000);
    expect(potsFor(state)).toEqual([
      { amount: 500, main: true, level: 0, eligibleUserIds: [1, 2, 3] },
    ]);
  });
});

describe('the uncalled bet', () => {
  it('goes back to the bettor when nobody could match it', () => {
    const state = game(3);
    // The button opens for 1 000, both blinds fold. The 800 nobody could
    // call is handed back, so the pot is only what was contested.
    applyAction(state, 1, { type: 'raise', amount: 1_000 }, 2_000);
    applyAction(state, 2, { type: 'fold' }, 2_000);
    applyAction(state, 3, { type: 'fold' }, 2_000);

    expect(state.phase).toBe('waiting');
    expect(state.lastResult?.winners).toEqual([
      { userId: 1, amount: 500, hand: null },
    ]);
    // The bettor keeps the 1 000 they put in and wins the 300 of blinds.
    expect(player(state, 1).stack).toBe(BUY_IN + 300);
    expect(player(state, 2).stack).toBe(BUY_IN - SB);
    expect(player(state, 3).stack).toBe(BUY_IN - BB);
    expect(totalChips(state)).toBe(3 * BUY_IN);
  });

  it('never counts the blinds as uncalled', () => {
    const state = game(2);
    // The small blind folds to the big blind: the blinds are a matched
    // pair, so the big blind wins the whole 300.
    applyAction(state, 1, { type: 'fold' }, 2_000);
    expect(state.lastResult?.winners).toEqual([
      { userId: 2, amount: 300, hand: null },
    ]);
    expect(player(state, 2).stack).toBe(BUY_IN + SB);
    expect(totalChips(state)).toBe(2 * BUY_IN);
  });

  it('hands back the excess of an all-in that was only partly called', () => {
    const state = gameWithStacks([1_000, 1_400, 10_000]);
    // The button is all-in for 1 000, the small blind is all-in for 1 400 and
    // the big blind folds: the 400 nobody could call goes back to the small
    // blind, so both all-in players are in for 1 000.
    applyAction(state, 1, { type: 'allin' }, 2_000);
    applyAction(state, 2, { type: 'allin' }, 2_000);
    applyAction(state, 3, { type: 'fold' }, 2_000);
    expect(state.lastResult?.pots[0].amount).toBe(2_200);
    expect(state.lastResult?.pots).toHaveLength(1);
  });
});

describe('short all-in raises', () => {
  // Player 1 sits on the button, 2 posts the small blind, 3 the big blind.
  // The action runs from the seat after the big blind, so with four players
  // player 4 opens, then 1, 2 and 3.
  it('do not reopen the betting for a player who already acted', () => {
    const state = gameWithStacks([10_000, 10_000, 1_400, 10_000]);
    // Player 4 raises to 1 000 (a full raise), 1 and 2 call and the big
    // blind is all-in for 1 400 — less than the last full raise.
    applyAction(state, 4, { type: 'raise', amount: 1_000 }, 2_000);
    applyAction(state, 1, { type: 'call' }, 2_000);
    applyAction(state, 2, { type: 'call' }, 2_000);
    applyAction(state, 3, { type: 'allin' }, 2_000);

    // The action comes back to player 4, who may only call or fold.
    expect(state.turnUserId).toBe(4);
    const legal = legalActionsFor(state, player(state, 4));
    expect(legal?.callAmount).toBe(400);
    expect(legal?.raise).toBeNull();
    expect(legal?.allIn).toBe(false);
    expect(() =>
      applyAction(state, 4, { type: 'raise', amount: 2_200 }, 2_000),
    ).toThrow(PokerError);

    applyAction(state, 4, { type: 'call' }, 2_000);
    // ...and the same goes for the button, who also acted before the all-in.
    expect(state.turnUserId).toBe(1);
    expect(legalActionsFor(state, player(state, 1))?.raise).toBeNull();
    expect(() =>
      applyAction(state, 1, { type: 'raise', amount: 2_200 }, 2_000),
    ).toThrow(PokerError);
  });

  it('keep the minimum raise at the last full raise', () => {
    // With five players 4 opens, then 5, 1, 2 and 3 — the button has not
    // acted yet when the short all-in lands.
    const state = gameWithStacks([10_000, 10_000, 10_000, 10_000, 1_200]);
    applyAction(state, 4, { type: 'raise', amount: 1_000 }, 2_000);
    applyAction(state, 5, { type: 'allin' }, 2_000);
    expect(state.currentBet).toBe(1_200);

    // The button may raise — but only by a full raise over the last full
    // raise of 800, so to 2 000 and not to 1 400.
    expect(state.turnUserId).toBe(1);
    const legal = legalActionsFor(state, player(state, 1));
    expect(legal?.raise).toEqual({ min: 2_000, max: 10_000 });
  });

  it('reopen the betting once a full raise comes in', () => {
    const state = gameWithStacks([10_000, 10_000, 10_000, 10_000, 1_200]);
    applyAction(state, 4, { type: 'raise', amount: 1_000 }, 2_000);
    applyAction(state, 5, { type: 'allin' }, 2_000);
    // The button raises the full 2 000, which reopens the betting for
    // everybody who has already acted.
    applyAction(state, 1, { type: 'raise', amount: 2_000 }, 2_000);
    applyAction(state, 2, { type: 'call' }, 2_000);
    applyAction(state, 3, { type: 'call' }, 2_000);
    expect(state.turnUserId).toBe(4);
    expect(legalActionsFor(state, player(state, 4))?.raise).not.toBeNull();
  });
});

describe('short blinds', () => {
  it('still have to be called in full', () => {
    const state = gameWithStacks([10_000, 150]);
    // The big blind can only post 150 of the 200 blind, so the small blind
    // still has to call the whole 200 to stay in.
    expect(player(state, 2).allIn).toBe(true);
    expect(player(state, 2).bet).toBe(150);
    const legal = legalActionsFor(state, player(state, 1));
    expect(legal?.callAmount).toBe(100);
  });
});

describe('turn timeouts', () => {
  it('auto-folds a timed-out player who faces a bet', () => {
    const state = game();
    tickTimeouts(state, 1_000 + TURN_MS + 1);
    expect(state.phase).toBe('waiting');
    expect(state.lastResult?.winners[0]).toMatchObject({
      userId: 2,
      amount: 300,
    });
  });

  it('auto-checks a timed-out player when there is nothing to call', () => {
    const state = game();
    applyAction(state, 1, { type: 'call' }, 2_000);
    applyAction(state, 2, { type: 'check' }, 2_000);
    expect(state.phase).toBe('flop');
    expect(state.turnUserId).toBe(2);

    const deadline = state.turnDeadline as number;
    tickTimeouts(state, deadline + 1);
    expect(state.phase).toBe('flop');
    expect(player(state, 2).lastAction).toBe('Checked');
    expect(state.turnUserId).toBe(1);
  });
});

describe('ready flags', () => {
  it('tracks who is ready and ignores duplicates', () => {
    const state = createState();
    markReady(state, 5);
    markReady(state, 5);
    expect(state.ready).toEqual([5]);
    expect(everyoneReady(state, [5, 6])).toBe(false);
    markReady(state, 6);
    expect(everyoneReady(state, [5, 6])).toBe(true);
  });
});
