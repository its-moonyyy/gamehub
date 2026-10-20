/**
 * Board geometry for Ludo, in 15x15 grid units. The cell list mirrors the
 * backend engine: index 12, 25, 38 and 51 are the four start squares, and a
 * token's progress runs 0..51 on the ring, 52..56 up its home column and 57
 * home. Only the drawing lives here — every rule is enforced on the server.
 */

export interface LudoCell {
  x: number
  y: number
}

/** The shared 52-cell ring, clockwise from the bottom arm's left column. */
export const LUDO_TRACK: LudoCell[] = [
  { x: 6, y: 13 },
  { x: 6, y: 12 },
  { x: 6, y: 11 },
  { x: 6, y: 10 },
  { x: 6, y: 9 },
  { x: 5, y: 8 },
  { x: 4, y: 8 },
  { x: 3, y: 8 },
  { x: 2, y: 8 },
  { x: 1, y: 8 },
  { x: 0, y: 8 },
  { x: 0, y: 7 },
  { x: 0, y: 6 },
  { x: 1, y: 6 },
  { x: 2, y: 6 },
  { x: 3, y: 6 },
  { x: 4, y: 6 },
  { x: 5, y: 6 },
  { x: 6, y: 5 },
  { x: 6, y: 4 },
  { x: 6, y: 3 },
  { x: 6, y: 2 },
  { x: 6, y: 1 },
  { x: 6, y: 0 },
  { x: 7, y: 0 },
  { x: 8, y: 0 },
  { x: 8, y: 1 },
  { x: 8, y: 2 },
  { x: 8, y: 3 },
  { x: 8, y: 4 },
  { x: 8, y: 5 },
  { x: 9, y: 6 },
  { x: 10, y: 6 },
  { x: 11, y: 6 },
  { x: 12, y: 6 },
  { x: 13, y: 6 },
  { x: 14, y: 6 },
  { x: 14, y: 7 },
  { x: 14, y: 8 },
  { x: 13, y: 8 },
  { x: 12, y: 8 },
  { x: 11, y: 8 },
  { x: 10, y: 8 },
  { x: 9, y: 8 },
  { x: 8, y: 9 },
  { x: 8, y: 10 },
  { x: 8, y: 11 },
  { x: 8, y: 12 },
  { x: 8, y: 13 },
  { x: 8, y: 14 },
  { x: 7, y: 14 },
  { x: 6, y: 14 },
]

/** Track cell each quadrant's tokens leave the base onto — engine constant. */
export const LUDO_START_INDEX = [12, 25, 38, 51]

/** Star squares: a token standing here can never be captured. */
export const LUDO_SAFE_CELLS = new Set([7, 12, 20, 25, 33, 38, 46, 51])

/** The five home-column cells per quadrant, outermost first. */
export const LUDO_HOME_COLUMN: LudoCell[][] = [
  [
    { x: 1, y: 7 },
    { x: 2, y: 7 },
    { x: 3, y: 7 },
    { x: 4, y: 7 },
    { x: 5, y: 7 },
  ],
  [
    { x: 7, y: 1 },
    { x: 7, y: 2 },
    { x: 7, y: 3 },
    { x: 7, y: 4 },
    { x: 7, y: 5 },
  ],
  [
    { x: 13, y: 7 },
    { x: 12, y: 7 },
    { x: 11, y: 7 },
    { x: 10, y: 7 },
    { x: 9, y: 7 },
  ],
  [
    { x: 7, y: 13 },
    { x: 7, y: 12 },
    { x: 7, y: 11 },
    { x: 7, y: 10 },
    { x: 7, y: 9 },
  ],
]

/** Top-left corner of each 6x6 home base, one per quadrant. */
export const LUDO_BASE_ORIGIN: LudoCell[] = [
  { x: 0, y: 0 },
  { x: 9, y: 0 },
  { x: 9, y: 9 },
  { x: 0, y: 9 },
]

/** Token spots inside a base, as offsets from its origin. */
export const LUDO_BASE_SLOTS: LudoCell[] = [
  { x: 1.7, y: 1.7 },
  { x: 4.3, y: 1.7 },
  { x: 1.7, y: 4.3 },
  { x: 4.3, y: 4.3 },
]

/** One colour per quadrant: red, yellow, green, blue. */
export const LUDO_COLORS = ['#fb7185', '#fbbf24', '#34d399', '#38bdf8']

/** Progress that means a token is home. */
export const LUDO_HOME_STEP = 57
/** Progress of the first cell of a home column. */
export const LUDO_HOME_COLUMN_START = 52

export function trackCell(quadrant: number, steps: number): LudoCell {
  return LUDO_TRACK[(LUDO_START_INDEX[quadrant] + steps) % LUDO_TRACK.length]
}

/**
 * Where a token is drawn (its centre, in grid units). Tokens sharing a cell
 * are nudged apart so every one of them stays tappable.
 */
export function tokenPoint(
  quadrant: number,
  steps: number,
  tokenIndex: number,
  stackIndex = 0,
): LudoCell {
  const offset = STACK_OFFSETS[stackIndex % STACK_OFFSETS.length]
  if (steps < 0) {
    const base = LUDO_BASE_ORIGIN[quadrant]
    const slot = LUDO_BASE_SLOTS[tokenIndex % LUDO_BASE_SLOTS.length]
    return { x: base.x + slot.x + offset.x, y: base.y + slot.y + offset.y }
  }
  if (steps >= LUDO_HOME_STEP) {
    // Home: tucked into this quadrant's triangle in the middle of the board.
    const spread = (tokenIndex - 1.5) * 0.46
    if (quadrant === 0) return { x: 6.72, y: 7.5 + spread }
    if (quadrant === 1) return { x: 7.5 + spread, y: 6.72 }
    if (quadrant === 2) return { x: 8.28, y: 7.5 + spread }
    return { x: 7.5 + spread, y: 8.28 }
  }
  if (steps >= LUDO_HOME_COLUMN_START) {
    const cell = LUDO_HOME_COLUMN[quadrant][steps - LUDO_HOME_COLUMN_START]
    return { x: cell.x + 0.5 + offset.x, y: cell.y + 0.5 + offset.y }
  }
  const cell = trackCell(quadrant, steps)
  return { x: cell.x + 0.5 + offset.x, y: cell.y + 0.5 + offset.y }
}

/** Small shift applied per extra token on the same cell, kept inside it. */
const STACK_OFFSETS: LudoCell[] = [
  { x: 0, y: 0 },
  { x: 0.17, y: -0.1 },
  { x: -0.17, y: 0.1 },
  { x: 0, y: 0.19 },
]

export function tokensOut(tokens: number[]): number {
  return tokens.filter((steps) => steps >= 0 && steps < LUDO_HOME_STEP).length
}

export function tokensHome(tokens: number[]): number {
  return tokens.filter((steps) => steps >= LUDO_HOME_STEP).length
}
