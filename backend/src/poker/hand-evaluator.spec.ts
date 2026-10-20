import { describe, expect, it } from 'vitest';
import { compareHands, evaluateHand } from './hand-evaluator.js';

describe('evaluateHand', () => {
  it('detects a royal flush', () => {
    const hand = evaluateHand(['As', 'Ks', 'Qs', 'Js', 'Ts']);
    expect(hand.category).toBe(8);
    expect(hand.name).toBe('Royal flush');
  });

  it('ranks a wheel as a five-high straight', () => {
    const hand = evaluateHand(['Ah', '2s', '3d', '4c', '5h']);
    expect(hand.category).toBe(4);
    expect(hand.tiebreakers).toEqual([5]);
  });

  it('finds the best five out of seven cards', () => {
    const hand = evaluateHand(['As', 'Kd', 'Qh', 'Js', 'Th', '2c', '3d']);
    expect(hand.category).toBe(4);
    expect(hand.tiebreakers).toEqual([14]);
  });

  it('prefers a flush over a straight', () => {
    const hand = evaluateHand(['Ah', 'Kh', '2h', '3h', '4h', '5s', '6d']);
    expect(hand.category).toBe(5);
    expect(hand.tiebreakers).toEqual([14, 13, 4, 3, 2]);
  });

  it('ranks quads above a full house', () => {
    const quads = evaluateHand(['Ah', 'Ad', 'Ac', 'As', 'Kd']);
    const fullHouse = evaluateHand(['Ah', 'Ad', 'Ac', 'Kd', 'Ks']);
    expect(quads.category).toBe(7);
    expect(fullHouse.category).toBe(6);
    expect(compareHands(quads, fullHouse)).toBeGreaterThan(0);
  });

  it('orders two pair by kicker', () => {
    const better = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '4s', '3c', '2d']);
    const worse = evaluateHand(['Ah', 'Ad', 'Kh', 'Kd', '3s', '3c', '2d']);
    expect(better.tiebreakers).toEqual([14, 13, 4]);
    expect(compareHands(better, worse)).toBeGreaterThan(0);
  });

  it('splits identical hands', () => {
    const a = evaluateHand(['As', 'Kd', 'Qh', 'Js', 'Th', '2c', '3d']);
    const b = evaluateHand(['Ac', 'Kd', 'Qh', 'Js', 'Th', '2d', '3c']);
    expect(compareHands(a, b)).toBe(0);
  });
});
