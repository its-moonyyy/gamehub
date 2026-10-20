import { cardRank, cardSuit, type Card } from './cards.js';

export interface HandValue {
  /** 0 = high card … 8 = straight flush. Higher is better. */
  category: number;
  /** Ranks compared in order after the category, most significant first. */
  tiebreakers: number[];
  name: string;
}

const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

/** Best five-card hand out of 5–7 cards. */
export function evaluateHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    throw new Error('At least five cards are needed to evaluate a hand');
  }
  if (cards.length === 5) {
    return evaluateFive(cards);
  }

  let best: HandValue | null = null;
  for (const combo of combinationsOfFive(cards)) {
    const value = evaluateFive(combo);
    if (!best || compareHands(value, best) > 0) {
      best = value;
    }
  }
  return best as HandValue;
}

/** Positive when `a` beats `b`, 0 when they tie. */
export function compareHands(a: HandValue, b: HandValue): number {
  if (a.category !== b.category) {
    return a.category - b.category;
  }
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i += 1) {
    const diff = (a.tiebreakers[i] ?? 0) - (b.tiebreakers[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function evaluateFive(cards: Card[]): HandValue {
  const ranks = cards.map(cardRank).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);
  const isFlush = suits.every((suit) => suit === suits[0]);

  const counts = new Map<number, number>();
  for (const rank of ranks) {
    counts.set(rank, (counts.get(rank) ?? 0) + 1);
  }
  // Groups sorted by count first, then rank — both descending.
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );

  const straightHigh = findStraightHigh(ranks);

  if (isFlush && straightHigh != null) {
    return make(8, [straightHigh], straightHigh === 14 ? 'Royal flush' : null);
  }
  if (groups[0][1] === 4) {
    return make(7, [groups[0][0], groups[1][0]]);
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return make(6, [groups[0][0], groups[1][0]]);
  }
  if (isFlush) {
    return make(5, ranks);
  }
  if (straightHigh != null) {
    return make(4, [straightHigh]);
  }
  if (groups[0][1] === 3) {
    return make(3, [groups[0][0], groups[1][0], groups[2][0]]);
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return make(2, [groups[0][0], groups[1][0], groups[2][0]]);
  }
  if (groups[0][1] === 2) {
    return make(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]);
  }
  return make(0, ranks);
}

/** Highest straight top card in a set of ranks, treating A-2-3-4-5 as a five-high straight. */
function findStraightHigh(ranks: number[]): number | null {
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  let run = 1;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i] === unique[i - 1] - 1) {
      run += 1;
      if (run >= 5) {
        return unique[i] + 4;
      }
    } else {
      run = 1;
    }
  }
  // Wheel: A-5-4-3-2.
  if (unique.includes(14) && [5, 4, 3, 2].every((r) => unique.includes(r))) {
    return 5;
  }
  return null;
}

function make(
  category: number,
  tiebreakers: number[],
  nameOverride: string | null = null,
): HandValue {
  return {
    category,
    tiebreakers,
    name: nameOverride ?? CATEGORY_NAMES[category],
  };
}

function* combinationsOfFive(cards: Card[]): Generator<Card[]> {
  const n = cards.length;
  for (let a = 0; a < n - 4; a += 1) {
    for (let b = a + 1; b < n - 3; b += 1) {
      for (let c = b + 1; c < n - 2; c += 1) {
        for (let d = c + 1; d < n - 1; d += 1) {
          for (let e = d + 1; e < n; e += 1) {
            yield [cards[a], cards[b], cards[c], cards[d], cards[e]];
          }
        }
      }
    }
  }
}
