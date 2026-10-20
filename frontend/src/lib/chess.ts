/**
 * Board geometry and glyphs for chess. The server owns the board as a
 * 64-square array indexed like FEN — 0 is a8, 63 is h1 — so the only job here
 * is naming squares, picking light/dark and drawing pieces.
 */

import type {
  ChessColor,
  ChessMoveRecord,
  ChessPiece,
  ChessPieceType,
} from './types'

export const CHESS_FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const

/** "e2" -> 52 (0 = a8 ... 63 = h1). */
export function squareIndex(square: string): number {
  const file = CHESS_FILES.indexOf(square[0] as (typeof CHESS_FILES)[number])
  const rank = Number(square[1])
  return (8 - rank) * 8 + file
}

/** 52 -> "e2". */
export function indexToSquare(index: number): string {
  return `${CHESS_FILES[index % 8]}${8 - Math.floor(index / 8)}`
}

/** a1 is dark — the board alternates from there. */
export function isLightSquare(square: string): boolean {
  const file = CHESS_FILES.indexOf(square[0] as (typeof CHESS_FILES)[number])
  const rank = Number(square[1])
  return (file + rank) % 2 === 0
}

/** The two board colours, shared by the room's board and the home reel still. */
export const CHESS_LIGHT_SQUARE = '#e7dfcb'
export const CHESS_DARK_SQUARE = '#6f8f6b'

/**
 * The board indexes in drawing order. White sits at the bottom; black sees
 * the board from the other side.
 */
export function boardOrder(color: ChessColor): number[] {
  const indexes = Array.from({ length: 64 }, (_, index) => index)
  return color === 'w' ? indexes : indexes.reverse()
}

/**
 * Solid glyphs for every piece — the side comes from the colour, not the
 * glyph, so white and black pieces are cut from the same shapes.
 */
export const CHESS_GLYPHS: Record<ChessPieceType, string> = {
  k: '♚',
  q: '♛',
  r: '♜',
  b: '♝',
  n: '♞',
  p: '♟',
}

export const CHESS_PIECE_NAMES: Record<ChessPieceType, string> = {
  k: 'King',
  q: 'Queen',
  r: 'Rook',
  b: 'Bishop',
  n: 'Knight',
  p: 'Pawn',
}

/** Stable key for a piece on a square — used by motion's enter animation. */
export function pieceKey(color: ChessColor, type: ChessPieceType): string {
  return `${color}${type}`
}

/**
 * The clocks a table can be created with. The ids are the contract with the
 * server (`CHESS_TIME_CONTROLS` in the chess engine) — an id the server does
 * not know is rejected when the table is created.
 */
export const CHESS_TIME_CONTROLS = [
  { id: '1+0', name: 'Bullet', blurb: 'one minute, no increment' },
  { id: '3+2', name: 'Blitz', blurb: 'three minutes plus two seconds a move' },
  { id: '5+0', name: 'Blitz', blurb: 'five minutes, no increment' },
  { id: '10+5', name: 'Rapid', blurb: 'ten minutes plus five seconds a move' },
] as const

export type ChessTimeControlId = (typeof CHESS_TIME_CONTROLS)[number]['id']

export const DEFAULT_CHESS_TIME_CONTROL: ChessTimeControlId = '3+2'

/** "3+2" plus a name and a sentence for the create-table dialog. */
export function chessTimeControl(id: string) {
  return (
    CHESS_TIME_CONTROLS.find((control) => control.id === id) ??
    CHESS_TIME_CONTROLS[1]
  )
}

/**
 * A bank in milliseconds: "3:00" while there is time, then tenths under
 * twenty seconds so a flag fall is never a surprise.
 */
export function formatClockMs(ms: number): string {
  const safe = Math.max(0, ms)
  if (safe < 20_000) {
    return (Math.ceil(safe / 100) / 10).toFixed(1)
  }
  const seconds = Math.ceil(safe / 1000)
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

/** Pawn units, for the material chip beside the captured pieces. */
const PIECE_VALUES: Record<ChessPieceType, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
}

/** What each side has taken, oldest first — white's tray holds black pieces. */
export function capturedPieces(moves: ChessMoveRecord[]): {
  w: ChessPieceType[]
  b: ChessPieceType[]
} {
  const captures: { w: ChessPieceType[]; b: ChessPieceType[] } = {
    w: [],
    b: [],
  }
  for (const move of moves) {
    if (move.captured) captures[move.color].push(move.captured)
  }
  return captures
}

/** Material still on the board, in pawn units, per side. */
export function boardMaterial(board: (ChessPiece | null)[]): {
  w: number
  b: number
} {
  const material = { w: 0, b: 0 }
  for (const piece of board) {
    if (piece) material[piece.color] += PIECE_VALUES[piece.type]
  }
  return material
}

