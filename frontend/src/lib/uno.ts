/**
 * Card helpers for Uno, mirroring the backend engine's codes: colour (R, Y,
 * G, B — or W for wild) plus value (0–9, S = skip, R = reverse, D = draw
 * two), with `W` and `WF` for the two wilds. Only presentation lives here —
 * every rule is enforced on the server.
 */

import type { UnoColor } from './types'

/** The four card colours, in deck order. */
export const UNO_COLORS: UnoColor[] = ['R', 'Y', 'G', 'B']

export const UNO_COLOR_NAMES: Record<UnoColor, string> = {
  R: 'Red',
  Y: 'Yellow',
  G: 'Green',
  B: 'Blue',
}

/** Card faces on the room's dark felt (same family as the Ludo palette). */
export const UNO_COLOR_HEX: Record<UnoColor, string> = {
  R: '#fb7185',
  Y: '#fbbf24',
  G: '#34d399',
  B: '#38bdf8',
}

/** The deep shade each card face fades into. */
export const UNO_COLOR_DEEP: Record<UnoColor, string> = {
  R: '#9f1239',
  Y: '#92400e',
  G: '#065f46',
  B: '#075985',
}

/** The colour of a card; wilds answer `W`. */
export function cardColor(card: string): UnoColor | 'W' {
  return card.startsWith('W') ? 'W' : (card.charAt(0) as UnoColor)
}

/** The value of a card: 0–9, S, R, D — or W / F for the wilds. */
export function cardValue(card: string): string {
  return card.slice(1) || 'W'
}

export function isWild(card: string): boolean {
  return cardColor(card) === 'W'
}

/** The small glyph in a card's corners. */
export function cardCorner(card: string): string {
  const value = cardValue(card)
  if (value === 'S') return '⊘'
  if (value === 'R') return '⇄'
  if (value === 'D') return '+2'
  if (value === 'F') return '+4'
  if (value === 'W') return 'W'
  return value
}

/** The big glyph in the middle of a card; empty for a plain wild. */
export function cardGlyph(card: string): string {
  const value = cardValue(card)
  if (value === 'W') return ''
  return cardCorner(card)
}

const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'S', 'R', 'D']

function valueIndex(card: string): number {
  const value = cardValue(card)
  if (value === 'W') return VALUE_ORDER.length
  if (value === 'F') return VALUE_ORDER.length + 1
  return VALUE_ORDER.indexOf(value)
}

/**
 * A stable hand order: colour first (wilds last), then value. Sorting keeps
 * the same card codes together, so polls never reshuffle what you are
 * looking at.
 */
export function sortHand(hand: string[]): string[] {
  const colorIndex = (card: string) => {
    const color = cardColor(card)
    return color === 'W' ? UNO_COLORS.length : UNO_COLORS.indexOf(color)
  }
  return [...hand].sort(
    (a, b) =>
      colorIndex(a) - colorIndex(b) ||
      valueIndex(a) - valueIndex(b) ||
      a.localeCompare(b),
  )
}

/**
 * Stable React keys for a hand that may hold duplicate codes (the deck has
 * two of most cards): the first `R5` is `R5#0`, the second `R5#1`.
 */
export function keyedHand(hand: string[]): { card: string; key: string }[] {
  const seen = new Map<string, number>()
  return sortHand(hand).map((card) => {
    const count = seen.get(card) ?? 0
    seen.set(card, count + 1)
    return { card, key: `${card}#${count}` }
  })
}
