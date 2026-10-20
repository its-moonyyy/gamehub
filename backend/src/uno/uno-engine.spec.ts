import { describe, expect, it } from 'vitest';
import {
  applyUnoAction,
  callUno,
  canPlayCard,
  catchUno,
  cardPoints,
  createUnoDeck,
  createUnoState,
  drawUno,
  everyoneUnoReady,
  isUnoPlaying,
  leaveUno,
  legalUnoActions,
  markUnoReady,
  passUno,
  playUnoCard,
  playableCards,
  startUno,
  tickUno,
  topDiscard,
  UnoError,
  UNO_CALL_MS,
  UNO_COLORS,
  type UnoCard,
  type UnoPlayer,
  type UnoState,
} from './uno-engine.js';

const TURN_MS = 45_000;

/**
 * Builds a rigged deck: each hand is dealt its cards in round-robin order,
 * then `rest` follows as the draw pile (its first card gets flipped unless
 * it is a wild, which is buried).
 */
function riggedDeck(hands: UnoCard[][], rest: UnoCard[]): UnoCard[] {
  const deck: UnoCard[] = [];
  const rounds = Math.max(...hands.map((hand) => hand.length));
  for (let round = 0; round < rounds; round += 1) {
    for (const hand of hands) {
      deck.push(hand[round] ?? 'R0');
    }
  }
  return [...deck, ...rest];
}

function game(hands: UnoCard[][], rest: UnoCard[], now = 1_000): UnoState {
  const state = createUnoState();
  startUno(state, {
    seats: hands.map((_, index) => ({ userId: index + 1, seatIndex: index })),
    turnMs: TURN_MS,
    now,
    deck: riggedDeck(hands, rest),
  });
  return state;
}

function player(state: UnoState, userId: number): UnoPlayer {
  const found = state.players.find((p) => p.userId === userId);
  if (!found) {
    throw new Error(`no player ${userId}`);
  }
  return found;
}

const RED_HAND: UnoCard[] = ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'];

describe('createUnoDeck', () => {
  it('builds the official 108-card deck', () => {
    const deck = createUnoDeck();
    expect(deck).toHaveLength(108);
    for (const color of UNO_COLORS) {
      expect(deck.filter((card) => card === `${color}0`)).toHaveLength(1);
      for (const value of [
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
      ]) {
        expect(
          deck.filter((card) => card === `${color}${value}`),
        ).toHaveLength(2);
      }
    }
    expect(deck.filter((card) => card === 'W')).toHaveLength(4);
    expect(deck.filter((card) => card === 'WF')).toHaveLength(4);
  });

  it('scores cards like the rulebook', () => {
    expect(cardPoints('R7')).toBe(7);
    expect(cardPoints('GS')).toBe(20);
    expect(cardPoints('BD')).toBe(20);
    expect(cardPoints('W')).toBe(50);
    expect(cardPoints('WF')).toBe(50);
  });
});

describe('startUno', () => {
  it('deals seven cards and flips a coloured card', () => {
    const state = game(
      [
        ['R5', 'Y1', 'G2', 'B3', 'R6', 'Y7', 'G8'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(state.phase).toBe('playing');
    expect(state.players[0].hand).toEqual([
      'R5',
      'Y1',
      'G2',
      'B3',
      'R6',
      'Y7',
      'G8',
    ]);
    expect(state.players[1].hand).toHaveLength(7);
    expect(topDiscard(state)).toBe('B5');
    expect(state.activeColor).toBe('B');
    expect(state.turnUserId).toBe(1);
    expect(state.turnDeadline).toBe(1_000 + TURN_MS);
    expect(state.direction).toBe(1);
    expect(state.pendingUno).toBeNull();
  });

  it('buries a wild draw four flip and flips the next card', () => {
    const state = game(
      [
        ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'],
        ['Y1', 'Y2', 'Y3', 'Y4', 'Y6', 'Y7', 'Y9'],
      ],
      ['WF', 'G7', 'G8', 'G9', 'G1', 'G2', 'G3', 'G4'],
    );
    expect(topDiscard(state)).toBe('G7');
    expect(state.activeColor).toBe('G');
    expect(state.drawPile[state.drawPile.length - 1]).toBe('WF');
  });

  it('allows a plain wild as the first card (first player chooses colour)', () => {
    const state = game(
      [
        ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'],
        ['Y1', 'Y2', 'Y3', 'Y4', 'Y6', 'Y7', 'Y9'],
      ],
      ['W', 'G7', 'G8', 'G9', 'G1', 'G2', 'G3', 'G4'],
    );
    expect(topDiscard(state)).toBe('W');
    // Active color is placeholder until first player plays
    expect(state.activeColor).toBe('R');
    // First player (userId 1) should be on turn
    expect(state.turnUserId).toBe(1);
  });

  it('rotates the starting player between games', () => {
    const state = game(
      [
        ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'],
        ['Y1', 'Y2', 'Y3', 'Y4', 'Y6', 'Y7', 'Y9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(state.turnUserId).toBe(1);
    state.phase = 'finished';
    startUno(state, {
      seats: [
        { userId: 1, seatIndex: 0 },
        { userId: 2, seatIndex: 1 },
      ],
      turnMs: TURN_MS,
      now: 2_000,
      deck: riggedDeck(
        [
          ['R1', 'R2', 'R3', 'R4', 'R6', 'R7', 'R9'],
          ['Y1', 'Y2', 'Y3', 'Y4', 'Y6', 'Y7', 'Y9'],
        ],
        ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
      ),
    });
    expect(state.gameNumber).toBe(2);
    expect(state.turnUserId).toBe(2);
  });

  it('refuses one player and more than six', () => {
    const state = createUnoState();
    expect(() =>
      startUno(state, {
        seats: [{ userId: 1, seatIndex: 0 }],
        turnMs: TURN_MS,
        now: 0,
      }),
    ).toThrow(UnoError);
    expect(() =>
      startUno(state, {
        seats: Array.from({ length: 7 }, (_, index) => ({
          userId: index + 1,
          seatIndex: index,
        })),
        turnMs: TURN_MS,
        now: 0,
      }),
    ).toThrow(UnoError);
  });
});

describe('playing cards', () => {
  it('plays a card that matches the value', () => {
    const state = game(
      [['R5', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    playUnoCard(state, 1, 'R5', undefined, 1_100);
    expect(topDiscard(state)).toBe('R5');
    expect(state.activeColor).toBe('R');
    expect(state.turnUserId).toBe(2);
    expect(player(state, 1).hand).not.toContain('R5');
  });

  it('plays a card that matches the colour', () => {
    const state = game(
      [['B3', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    playUnoCard(state, 1, 'B3', undefined, 1_100);
    expect(state.activeColor).toBe('B');
    expect(topDiscard(state)).toBe('B3');
  });

  it('rejects a card that matches neither colour nor value', () => {
    const state = game(
      [['G3', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(() => playUnoCard(state, 1, 'G3', undefined, 1_100)).toThrow(
      UnoError,
    );
    expect(player(state, 1).hand).toContain('G3');
    expect(state.turnUserId).toBe(1);
  });

  it('rejects a card that is not in your hand and out-of-turn play', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(() => playUnoCard(state, 1, 'B5', undefined, 1_100)).toThrow(
      UnoError,
    );
    expect(() => playUnoCard(state, 2, 'R9', undefined, 1_100)).toThrow(
      'not your turn',
    );
  });
});

describe('action cards', () => {
  it('skips the next player', () => {
    const state = game(
      [
        ['BS', ...RED_HAND.slice(1)],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
        ['G1', 'G2', 'G3', 'G4', 'G6', 'G7', 'G9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    playUnoCard(state, 1, 'BS', undefined, 1_100);
    expect(state.turnUserId).toBe(3);
    expect(player(state, 2).lastAction).toBe('Skipped');
  });

  it('reverses the direction with three players', () => {
    const state = game(
      [
        ['BR', ...RED_HAND.slice(1)],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
        ['G1', 'G2', 'G3', 'G4', 'G6', 'G7', 'G9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    playUnoCard(state, 1, 'BR', undefined, 1_100);
    expect(state.direction).toBe(-1);
    // Counter-clockwise from seat 1 is seat 3.
    expect(state.turnUserId).toBe(3);
  });

  it('turns a reverse into a skip in heads-up', () => {
    const state = game(
      [['BR', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    playUnoCard(state, 1, 'BR', undefined, 1_100);
    expect(state.direction).toBe(-1);
    expect(state.turnUserId).toBe(1);
  });

  it('makes the next player draw two and lose the turn', () => {
    const state = game(
      [
        ['BD', ...RED_HAND.slice(1)],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
        ['G1', 'G2', 'G3', 'G4', 'G6', 'G7', 'G9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'],
    );
    playUnoCard(state, 1, 'BD', undefined, 1_100);
    expect(player(state, 2).hand).toHaveLength(9);
    expect(player(state, 2).lastAction).toBe('Drew 2 — skipped');
    expect(state.turnUserId).toBe(3);
  });

  it('lets a wild pick the next colour and demands a colour', () => {
    const state = game(
      [
        ['W', 'R1', 'R2', 'R3', 'R4', 'R6', 'R7'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(() => playUnoCard(state, 1, 'W', undefined, 1_100)).toThrow(
      'Pick a colour',
    );
    expect(player(state, 1).hand).toContain('W');

    playUnoCard(state, 1, 'W', 'G', 1_100);
    expect(topDiscard(state)).toBe('W');
    expect(state.activeColor).toBe('G');
    expect(state.turnUserId).toBe(2);
  });

  it('wild draw four is always playable but can be challenged', () => {
    const withBlue = game(
      [
        ['WF', 'B1', 'R2', 'R3', 'R4', 'R6', 'R7'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    // WF4 is playable even with matching color in hand
    playUnoCard(withBlue, 1, 'WF', 'Y', 1_100);
    // Challenge window opens for player 2 (victim)
    expect(withBlue.pendingChallenge).toEqual({
      userId: 1,
      card: 'WF',
      color: 'B', // active color was B
      victimId: 2,
    });
    expect(withBlue.turnUserId).toBe(2);
    expect(legalUnoActions(withBlue, 2)?.challengeWf4).toEqual({
      offenderUserId: 1,
      victimUserId: 2,
    });

    const withoutBlue = game(
      [
        ['WF', 'R1', 'R2', 'R3', 'R4', 'R6', 'R7'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9'],
    );
    // No matching color - no challenge, effect applies immediately
    playUnoCard(withoutBlue, 1, 'WF', 'Y', 1_100);
    expect(withoutBlue.activeColor).toBe('Y');
    expect(player(withoutBlue, 2).hand).toHaveLength(11);
    expect(player(withoutBlue, 2).lastAction).toBe('Drew 4 — skipped');
    expect(withoutBlue.pendingChallenge).toBeNull();
  });
});

describe('drawing', () => {
  it('passes the turn when the drawn card cannot be played', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    drawUno(state, 1, 1_100);
    expect(player(state, 1).hand).toHaveLength(8);
    expect(player(state, 1).hand).toContain('G1');
    expect(state.drawnCard).toBeNull();
    expect(state.turnUserId).toBe(2);
  });

  it('keeps the turn when the drawn card is playable, and only it may play', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'B3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
    );
    drawUno(state, 1, 1_100);
    expect(state.drawnCard).toBe('B3');
    expect(state.turnUserId).toBe(1);

    const legal = legalUnoActions(state, 1);
    expect(legal?.playable).toEqual(['B3']);
    expect(legal?.draw).toBe(false);
    expect(legal?.pass).toBe(true);

    expect(() => playUnoCard(state, 1, 'R1', undefined, 1_200)).toThrow(
      'only play the card you drew',
    );
    playUnoCard(state, 1, 'B3', undefined, 1_200);
    expect(topDiscard(state)).toBe('B3');
    expect(state.turnUserId).toBe(2);
  });

  it('lets the player pass after a playable draw', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'B3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
    );
    drawUno(state, 1, 1_100);
    passUno(state, 1, 1_200);
    expect(state.turnUserId).toBe(2);
    expect(player(state, 1).hand).toHaveLength(8);
    expect(player(state, 1).lastAction).toBe('Passed');
  });

  it('refuses a second draw and an early pass', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'B3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
    );
    expect(() => passUno(state, 1, 1_100)).toThrow('Draw a card first');
    drawUno(state, 1, 1_100);
    expect(() => drawUno(state, 1, 1_200)).toThrow(UnoError);
  });

  it('recycles the discard pile when the draw pile runs dry', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5'],
    );
    // Only the top card is on the table; everything under it comes back.
    state.discardPile = ['R1', 'B5'];
    state.drawPile = [];
    drawUno(state, 1, 1_100);
    expect(topDiscard(state)).toBe('B5');
    expect(player(state, 1).hand).toHaveLength(8);
  });
});

describe('the UNO call', () => {
  function oneCardState(): UnoState {
    return game(
      [
        ['R5', 'R3', 'R4', 'R6', 'R7', 'R9', 'R2'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
  }

  it('opens a catch window when a player goes down to one card', () => {
    const state = oneCardState();
    // Empty the hand down to two playable cards first.
    player(state, 1).hand = ['R2', 'B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    expect(state.pendingUno).toEqual({ userId: 1, deadline: Infinity });
    expect(legalUnoActions(state, 1)?.callUno).toBe(true);
    expect(legalUnoActions(state, 2)?.catchUserId).toBe(1);
  });

  it('penalises a player caught before calling UNO', () => {
    const state = oneCardState();
    player(state, 1).hand = ['R2', 'B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    catchUno(state, 2, 1_200);
    expect(player(state, 1).hand).toHaveLength(3);
    expect(state.pendingUno).toBeNull();
    expect(player(state, 2).lastAction).toBe('Caught a missing UNO');
  });

  it('protects a player who calls UNO in time', () => {
    const state = oneCardState();
    player(state, 1).hand = ['R2', 'B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    callUno(state, 1);
    expect(state.pendingUno).toBeNull();
    expect(player(state, 1).saidUno).toBe(true);
    expect(() => catchUno(state, 2, 1_200)).toThrow('Nobody is on the hook');
  });

  it('closes the window when the next player acts', () => {
    const state = oneCardState();
    player(state, 1).hand = ['R2', 'B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    // Player 2 acts (draws) - this should close the UNO window for player 1
    drawUno(state, 2, 1_200);
    expect(state.pendingUno).toBeNull();
    expect(() => catchUno(state, 2, 1_300)).toThrow('Nobody is on the hook');
  });

  it('refuses a self-catch and a catch with nothing pending', () => {
    const state = oneCardState();
    expect(() => catchUno(state, 2, 1_100)).toThrow('Nobody is on the hook');
    player(state, 1).hand = ['R2', 'B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    expect(() => catchUno(state, 1, 1_200)).toThrow('cannot catch yourself');
  });
});

describe('winning', () => {
  it('ends the game and scores the other hands', () => {
    const state = game(
      [
        ['R5', 'R3', 'R4', 'R6', 'R7', 'R9', 'R2'],
        ['Y2', 'G3', 'B4', 'R1', 'Y3', 'G4', 'R9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    player(state, 1).hand = ['B5'];
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.winnerUserId).toBe(1);
    // Y2+G3+B4+R1+Y3+G4+R9 = 2+3+4+1+3+4+9
    expect(state.lastResult?.points).toBe(26);
    expect(state.lastResult?.remaining).toEqual([
      { userId: 1, cards: 0 },
      { userId: 2, cards: 7 },
    ]);
    expect(state.turnUserId).toBeNull();
    expect(state.pendingUno).toBeNull();
  });

  it('never opens a UNO window on the winning card', () => {
    const state = game(
      [
        ['R5', 'R3', 'R4', 'R6', 'R7', 'R9', 'R2'],
        ['Y2', 'G3', 'B4', 'R1', 'Y3', 'G4', 'R9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    player(state, 1).hand = ['B5'];
    player(state, 1).saidUno = true;
    playUnoCard(state, 1, 'B5', undefined, 1_100);
    expect(state.pendingUno).toBeNull();
  });
});

describe('ready-up', () => {
  it('tracks ready seats and needs two players', () => {
    const state = createUnoState();
    markUnoReady(state, 1);
    expect(everyoneUnoReady(state, [1, 2])).toBe(false);
    markUnoReady(state, 2);
    expect(everyoneUnoReady(state, [1, 2])).toBe(true);
    expect(everyoneUnoReady(state, [1])).toBe(false);
    expect(everyoneUnoReady(state, [1, 2, 3, 4, 5, 6, 7])).toBe(false);
    expect(() => {
      state.phase = 'playing';
      markUnoReady(state, 3);
    }).toThrow('already running');
  });
});

describe('timeouts', () => {
  it('plays the first legal card when the clock runs out', () => {
    const state = game(
      [['B3', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(tickUno(state, 1_000 + TURN_MS)).toBe(true);
    expect(topDiscard(state)).toBe('B3');
    expect(state.turnUserId).toBe(2);
  });

  it('draws when nothing is playable and plays a playable draw', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'B3', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6'],
    );
    tickUno(state, 1_000 + TURN_MS);
    // Drew B3 and played it in the same tick.
    expect(topDiscard(state)).toBe('B3');
    expect(player(state, 1).hand).toHaveLength(7);
    expect(state.turnUserId).toBe(2);
  });

  it('picks the colour a timed-out player holds most of', () => {
    const state = game(
      [
        ['W', 'G1', 'G2', 'G3', 'G4', 'R1', 'R2'],
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
      ],
      ['B5', 'G5', 'G6', 'G7', 'G8', 'G9', 'G1', 'G2'],
    );
    tickUno(state, 1_000 + TURN_MS);
    expect(topDiscard(state)).toBe('W');
    expect(state.activeColor).toBe('G');
  });

  it('leaves a fresh clock alone', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    expect(tickUno(state, 1_500)).toBe(false);
    expect(state.turnUserId).toBe(1);
  });
});

describe('leaving', () => {
  it('removes a player between games', () => {
    const state = createUnoState();
    markUnoReady(state, 1);
    leaveUno(state, 1, 1_000);
    expect(state.ready).toEqual([]);
    expect(state.players).toEqual([]);
  });

  it('ends the game for the survivor when the last opponent leaves', () => {
    const state = game(
      [RED_HAND, ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    leaveUno(state, 2, 1_100);
    expect(state.phase).toBe('finished');
    expect(state.lastResult?.winnerUserId).toBe(1);
  });

  it('passes the turn on when the player on the clock leaves', () => {
    const state = game(
      [
        RED_HAND,
        ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4'],
        ['G1', 'G2', 'G3', 'G4', 'G6', 'G7', 'G9'],
      ],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    leaveUno(state, 1, 1_100);
    expect(state.players.map((p) => p.userId)).toEqual([2, 3]);
    expect(state.turnUserId).toBe(2);
  });
});

describe('legal actions', () => {
  it('describes the viewer, not the table', () => {
    const state = game(
      [['B3', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    const mine = legalUnoActions(state, 1);
    expect(mine?.playable).toContain('B3');
    expect(mine?.draw).toBe(true);
    expect(mine?.callUno).toBe(false);

    const theirs = legalUnoActions(state, 2);
    expect(theirs?.playable).toEqual([]);
    expect(theirs?.draw).toBe(false);
    expect(theirs?.catchUserId).toBeNull();

    expect(legalUnoActions(state, 99)).toBeNull();
    state.phase = 'finished';
    expect(legalUnoActions(state, 1)).toBeNull();
  });

  it('exposes playable cards only for matching cards', () => {
    const state = game(
      [['B3', 'R5', ...RED_HAND.slice(2)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    const me = player(state, 1);
    expect(canPlayCard(state, me, 'B3')).toBe(true);
    expect(canPlayCard(state, me, 'R5')).toBe(true);
    expect(canPlayCard(state, me, 'R3')).toBe(false);
    expect(playableCards(state, me)).toEqual(['B3', 'R5']);
  });
});

describe('applyUnoAction', () => {
  it('dispatches the table actions', () => {
    const state = game(
      [['B3', ...RED_HAND.slice(1)], ['R9', 'Y2', 'G3', 'B4', 'R1', 'Y3', 'G4']],
      ['B5', 'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'],
    );
    applyUnoAction(state, 1, { type: 'draw' }, 1_100);
    expect(player(state, 1).hand).toHaveLength(8);
    expect(() =>
      applyUnoAction(state, 1, { type: 'fold' as never }, 1_200),
    ).toThrow('Unknown action');
    expect(isUnoPlaying(state)).toBe(true);
  });
});
