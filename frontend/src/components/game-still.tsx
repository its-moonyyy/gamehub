import { DominoPiece } from '@/components/domino-piece'
import { UnoCardBack, UnoCardFace } from '@/components/uno-card'
import {
  CHESS_DARK_SQUARE,
  CHESS_GLYPHS,
  CHESS_LIGHT_SQUARE,
  indexToSquare,
  isLightSquare,
} from '@/lib/chess'
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
import type { ChessPieceType } from '@/lib/types'
import {
  LUDO_BASE_ORIGIN,
  LUDO_BASE_SLOTS,
  LUDO_COLORS,
  LUDO_HOME_COLUMN,
  LUDO_START_INDEX,
  LUDO_TRACK,
} from '@/lib/ludo'
import { cn } from '@/lib/utils'

/**
 * The still shown for a game on the home reel: each game's own art — the
 * poker banner for poker, the board and dice drawn in CSS/SVG for Ludo — so a
 * still always matches what the game actually looks like.
 *
 * Sized by the parent — the still fills it and scales its own details with
 * container query units, so one component works at thumbnail and full size.
 */
export function GameStill({
  slug,
  icon,
  className,
}: {
  slug: string
  icon?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        '@container relative size-full overflow-hidden rounded-xl border border-border bg-[#0b100e]',
        className,
      )}
    >
      {slug === 'poker' ? (
        <PokerStill />
      ) : slug === 'ludo' ? (
        <LudoStill />
      ) : slug === 'dominoes' ? (
        <DominoesStill />
      ) : slug === 'chess' ? (
        <ChessStill />
      ) : slug === 'uno' ? (
        <UnoStill />
      ) : (
        <GenericStill icon={icon} />
      )}
      {/* Film vignette: pulls the eye to the middle of the frame. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_85%_at_50%_20%,transparent_55%,rgba(0,0,0,0.45)_100%)]"
      />
    </div>
  )
}

/** The poker banner, cover-cropped on the floating ace so it reads in 16:9. */
function PokerStill() {
  return (
    <>
      <img
        src="/game/poker-banner.jpeg"
        alt=""
        draggable={false}
        className="absolute inset-0 size-full select-none object-cover object-[50%_32%]"
      />
      {/* Ease the banner's edges into the reel's dark frame. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(0,0,0,0.5),transparent_35%,transparent_70%,rgba(0,0,0,0.35))]"
      />
    </>
  )
}

/** Pips of a die, on a 0..1 square: the values Ludo actually rolls. */
const DIE_PIPS: Record<number, [number, number][]> = {
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.26, 0.2],
    [0.74, 0.2],
    [0.26, 0.5],
    [0.74, 0.5],
    [0.26, 0.8],
    [0.74, 0.8],
  ],
}

/** A die, resting on the table beside the board. */
function Die({
  x,
  y,
  value,
  angle,
}: {
  x: number
  y: number
  value: number
  angle: number
}) {
  const size = 2.6
  const pips = DIE_PIPS[value] ?? []

  return (
    <g transform={`translate(${x} ${y}) rotate(${angle} ${size / 2} ${size / 2})`}>
      <ellipse cx={size / 2} cy={size + 0.22} rx={size * 0.52} ry={0.26} fill="#000" fillOpacity={0.45} />
      <rect width={size} height={size} rx={0.55} fill="#f7f8f6" />
      <rect width={size} height={size} rx={0.55} fill="none" stroke="#0b100e" strokeOpacity={0.35} strokeWidth={0.07} />
      {pips.map(([px, py]) => (
        <circle key={`${px}-${py}`} cx={px * size} cy={py * size} r={size * 0.105} fill="#121917" />
      ))}
    </g>
  )
}

/** The Ludo board on its table, four tokens parked and two dice at rest. */
function LudoStill() {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(80%_70%_at_50%_50%,oklch(0.44_0.05_210/0.55),transparent_74%)]"
      />
      <svg viewBox="0 0 26 15" className="size-full" aria-hidden>
        <Die x={1.5} y={8.7} value={5} angle={-11} />
        <Die x={21.9} y={3.2} value={6} angle={9} />

        <g transform="translate(5.9 0.3) scale(0.96)">
          {LUDO_BASE_ORIGIN.map((origin, quadrant) => (
            <g key={quadrant}>
              <rect
                x={origin.x + 0.45}
                y={origin.y + 0.45}
                width={5.1}
                height={5.1}
                rx={0.8}
                fill={LUDO_COLORS[quadrant]}
                fillOpacity={0.1}
                stroke={LUDO_COLORS[quadrant]}
                strokeOpacity={0.4}
                strokeWidth={0.09}
              />
              {LUDO_BASE_SLOTS.map((slot, slotIndex) => (
                <circle
                  key={slotIndex}
                  cx={origin.x + slot.x}
                  cy={origin.y + slot.y}
                  r={0.55}
                  fill={LUDO_COLORS[quadrant]}
                  stroke="#080d0b"
                  strokeWidth={0.1}
                />
              ))}
            </g>
          ))}

          {LUDO_TRACK.map((cell, index) => (
            <rect
              key={index}
              x={cell.x + 0.14}
              y={cell.y + 0.14}
              width={0.72}
              height={0.72}
              rx={0.16}
              fill="#18211d"
              stroke="#2b3833"
              strokeWidth={0.06}
            />
          ))}

          {LUDO_START_INDEX.map((cellIndex, quadrant) => (
            <rect
              key={cellIndex}
              x={LUDO_TRACK[cellIndex].x + 0.14}
              y={LUDO_TRACK[cellIndex].y + 0.14}
              width={0.72}
              height={0.72}
              rx={0.16}
              fill={LUDO_COLORS[quadrant]}
              fillOpacity={0.7}
            />
          ))}

          {LUDO_HOME_COLUMN.map((column, quadrant) =>
            column.map((cell, index) => (
              <rect
                key={`${quadrant}-${index}`}
                x={cell.x + 0.16}
                y={cell.y + 0.16}
                width={0.68}
                height={0.68}
                rx={0.14}
                fill={LUDO_COLORS[quadrant]}
                fillOpacity={0.45}
              />
            )),
          )}

          <polygon points="6,6 7.5,7.5 6,9" fill={LUDO_COLORS[0]} />
          <polygon points="6,6 9,6 7.5,7.5" fill={LUDO_COLORS[1]} />
          <polygon points="9,6 9,9 7.5,7.5" fill={LUDO_COLORS[2]} />
          <polygon points="6,9 7.5,7.5 9,9" fill={LUDO_COLORS[3]} />
        </g>
      </svg>
    </>
  )
}

/** How the still lays out its sample chain: position, angle and pip values. */
const STILL_TILES: Array<{
  a: number
  b: number
  left: string
  top: string
  rotate: string
}> = [
  { a: 6, b: 6, left: '12%', top: '34%', rotate: '-9deg' },
  { a: 6, b: 2, left: '26%', top: '29%', rotate: '5deg' },
  { a: 2, b: 5, left: '40%', top: '36%', rotate: '-4deg' },
  { a: 5, b: 5, left: '54%', top: '28%', rotate: '7deg' },
  { a: 5, b: 1, left: '68%', top: '35%', rotate: '-6deg' },
]

/** The Dominoes table: a short chain on green felt with the boneyard beside. */
function DominoesStill() {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(85%_75%_at_50%_48%,oklch(0.42_0.06_165/0.65),transparent_76%)]"
      />
      {/* Face-down boneyard, waiting at the edge of the table. */}
      <div
        aria-hidden
        className="absolute top-[13%] right-[7%] w-[13%] rotate-12 opacity-80 drop-shadow-lg"
      >
        <DominoPiece a={0} b={0} faceDown />
      </div>
      <div
        aria-hidden
        className="absolute top-[53%] right-[3%] w-[13%] rotate-[24deg] opacity-70 drop-shadow-lg"
      >
        <DominoPiece a={0} b={0} faceDown />
      </div>

      {STILL_TILES.map((tile, index) => (
        <div
          key={index}
          aria-hidden
          className="absolute w-[17%] drop-shadow-[0_6px_10px_rgba(0,0,0,0.55)]"
          style={{
            left: tile.left,
            top: tile.top,
            rotate: tile.rotate,
          }}
        >
          <DominoPiece a={tile.a} b={tile.b} />
        </div>
      ))}
    </>
  )
}

/**
 * The opening position, written the way chess players write it: lower case is
 * black, upper case white, and the rows run from rank 8 down to rank 1.
 */
const STILL_RANKS = [
  'rnbqkbnr',
  'pppppppp',
  '........',
  '........',
  '........',
  '........',
  'PPPPPPPP',
  'RNBQKBNR',
]

/** The chess board on its table, tipped towards the viewer, pieces set. */
function ChessStill() {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(78%_72%_at_50%_50%,oklch(0.46_0.05_150/0.6),transparent_76%)]"
      />
      <div
        aria-hidden
        className="absolute top-1/2 left-1/2 aspect-square h-[78cqh] -translate-x-1/2 -translate-y-1/2 [perspective:1200px]"
      >
        <div className="grid size-full grid-cols-8 grid-rows-8 overflow-hidden rounded-[0.35em] border border-white/10 shadow-[0_18px_45px_rgba(0,0,0,0.62)] [transform:rotateX(15deg)]">
          {Array.from({ length: 64 }, (_, index) => {
            const square = indexToSquare(index)
            const letter = STILL_RANKS[Math.floor(index / 8)][index % 8]
            const white = letter === letter.toUpperCase()
            const type = letter.toLowerCase() as ChessPieceType

            return (
              <span
                key={square}
                className="flex items-center justify-center"
                style={{
                  backgroundColor: isLightSquare(square)
                    ? CHESS_LIGHT_SQUARE
                    : CHESS_DARK_SQUARE,
                }}
              >
                {letter !== '.' && (
                  <span
                    className={cn(
                      'text-[7cqh] leading-none select-none',
                      white
                        ? 'text-[#fdfaf1] drop-shadow-[0_0.5cqh_0.4cqh_rgba(0,0,0,0.55)]'
                        : 'text-[#121814] drop-shadow-[0_0.4cqh_0.3cqh_rgba(0,0,0,0.4)]',
                    )}
                  >
                    {CHESS_GLYPHS[type]}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      </div>
    </>
  )
}

/**
 * How the still lays out its sample hand: the card code, where it sits and
 * how far it is tilted. The cards fan left to right, the way a hand does.
 */
const STILL_CARDS: Array<{
  card: string
  left: string
  top: string
  rotate: string
}> = [
  { card: 'R7', left: '6%', top: '28%', rotate: '-10deg' },
  { card: 'BD', left: '19%', top: '23%', rotate: '-4deg' },
  { card: 'GS', left: '32%', top: '27%', rotate: '3deg' },
  { card: 'WF', left: '45%', top: '22%', rotate: '9deg' },
  { card: 'Y2', left: '58%', top: '30%', rotate: '15deg' },
]

/** The Uno table: a fanned hand mid-game with the draw pile beside it. */
function UnoStill() {
  return (
    <>
      <span
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(85%_75%_at_50%_48%,oklch(0.42_0.07_20/0.55),transparent_76%)]"
      />
      {/* Face-down pile, waiting to be drawn from. */}
      <div
        aria-hidden
        className="absolute top-[15%] right-[6%] w-[15%] rotate-12 opacity-85 drop-shadow-lg"
      >
        <UnoCardBack />
      </div>
      <div
        aria-hidden
        className="absolute top-[53%] right-[3%] w-[14%] rotate-[24deg] opacity-70 drop-shadow-lg"
      >
        <UnoCardBack />
      </div>

      {STILL_CARDS.map((entry, index) => (
        <div
          key={entry.card}
          aria-hidden
          className="absolute w-[17%] drop-shadow-[0_6px_12px_rgba(0,0,0,0.55)]"
          style={{ left: entry.left, top: entry.top, rotate: entry.rotate, zIndex: index }}
        >
          <UnoCardFace card={entry.card} />
        </div>
      ))}
    </>
  )
}

/** Anything the catalog grows later: its icon on a neutral stage. */function GenericStill({ icon }: { icon?: string }) {
  const Icon = (icon && GAME_ICONS[icon]) || FALLBACK_GAME_ICON

  return (
    <div className="flex size-full items-center justify-center bg-muted">
      <Icon className="size-[26cqw] text-muted-foreground" />
    </div>
  )
}
