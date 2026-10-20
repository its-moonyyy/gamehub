import { randomInt } from 'node:crypto';

export type Suit = 's' | 'h' | 'd' | 'c';

/** Card code: rank char + suit char, e.g. 'As', 'Td', '2c'. */
export type Card = string;

export const RANK_CHARS = '23456789TJQKA';
export const SUITS: Suit[] = ['s', 'h', 'd', 'c'];

/** 2–14 (14 = ace). */
export function cardRank(card: Card): number {
  return RANK_CHARS.indexOf(card[0]) + 2;
}

export function cardSuit(card: Card): Suit {
  return card[1] as Suit;
}

export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANK_CHARS) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

/** Fisher–Yates shuffle with cryptographic randomness. */
export function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
