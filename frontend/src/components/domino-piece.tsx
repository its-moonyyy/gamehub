import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pips of one half on a 3x3 grid (col, row). A double-six set only ever shows
 * 0..6, so this table is complete.
 */
const PIP_LAYOUT: Record<number, Array<[number, number]>> = {
  0: [],
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
}

const HALF = 45
const PIP_RADIUS = 3.6
/** Cell centres inside one half of the 90x45 tile. */
function pipPoint(col: number, row: number): { x: number; y: number } {
  return { x: 11.25 + col * 11.25, y: 11.25 + row * 11.25 }
}

export interface DominoPieceProps {
  /** First half pips (left half lying down, top half upright). */
  a: number
  /** Second half pips. */
  b: number
  /** Draw this side face down (used for the boneyard). */
  faceDown?: boolean
  /** Stand the tile on its end: halves stacked top/bottom instead of left/right. */
  vertical?: boolean
  className?: string
  /**
   * Explicit size, for places where the tile sits inside a shadcn `Button`:
   * its icon rule (`[&_svg]:size-4`) would otherwise shrink the piece to a
   * 16px icon. Inline styles beat that class.
   */
  style?: CSSProperties
}

/**
 * A single domino tile, drawn from its two pip values. The order of the halves
 * is already resolved by the server before a tile reaches the board, so this
 * component never has to guess which half is which. Both orientations keep the
 * pip patterns upright — the halves are square either way.
 */
export function DominoPiece({
  a,
  b,
  faceDown,
  vertical = false,
  className,
  style,
}: DominoPieceProps) {
  const width = vertical ? HALF : HALF * 2
  const height = vertical ? HALF * 2 : HALF
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={faceDown ? 'Face-down domino' : `Domino ${a}–${b}`}
      className={cn('block h-auto w-full', className)}
      style={style}
    >
      <rect
        x={0.6}
        y={0.6}
        width={width - 1.2}
        height={height - 1.2}
        rx={6}
        fill={faceDown ? '#1b2320' : '#f5f1e6'}
        stroke="rgba(0,0,0,0.38)"
        strokeWidth={1.2}
      />
      {faceDown ? (
        <>
          <rect
            x={8}
            y={8}
            width={width - 16}
            height={height - 16}
            rx={4}
            fill="none"
            stroke="rgba(255,255,255,0.22)"
            strokeWidth={1.2}
          />
          <circle
            cx={width / 2}
            cy={height / 2}
            r={3.2}
            fill="rgba(255,255,255,0.35)"
          />
        </>
      ) : (
        <>
          {(
            [
              [a, 0],
              [b, HALF],
            ] as const
          ).map(([value, offset]) =>
            (PIP_LAYOUT[value] ?? []).map(([col, row]) => {
              const point = pipPoint(col, row)
              return (
                <circle
                  key={`${value}-${col}-${row}-${offset}`}
                  cx={vertical ? point.x : point.x + offset}
                  cy={vertical ? point.y + offset : point.y}
                  r={PIP_RADIUS}
                  fill="#171c1a"
                />
              )
            }),
          )}
          <line
            x1={vertical ? 4.5 : HALF}
            y1={vertical ? HALF : 4.5}
            x2={vertical ? width - 4.5 : HALF}
            y2={vertical ? HALF : height - 4.5}
            stroke="rgba(0,0,0,0.42)"
            strokeWidth={1.1}
          />
        </>
      )}
    </svg>
  )
}
