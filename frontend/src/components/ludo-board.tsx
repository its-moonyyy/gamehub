import {
  LUDO_BASE_ORIGIN,
  LUDO_BASE_SLOTS,
  LUDO_COLORS,
  LUDO_HOME_COLUMN,
  LUDO_HOME_COLUMN_START,
  LUDO_HOME_STEP,
  LUDO_SAFE_CELLS,
  LUDO_START_INDEX,
  LUDO_TRACK,
  tokenPoint,
  type LudoCell,
} from '@/lib/ludo'
import type { LudoLegalActions, LudoPlayer } from '@/lib/types'
import { cn } from '@/lib/utils'

const BOARD_BG = '#0d1412'
const CELL_FILL = '#1a231f'
const CELL_STROKE = '#2c3a34'
const TOKEN_EDGE = '#0a100e'

interface LudoBoardProps {
  /** Everyone in the game — the board shows all four colours at once. */
  players: LudoPlayer[]
  /** Whose tokens this viewer may pick up. */
  myUserId: number | null
  /** The viewer's legal moves; null while somebody else is on the clock. */
  legal: LudoLegalActions | null
  onMove: (tokenId: number) => void
  className?: string
}

/**
 * The 15x15 Ludo board. Everything is drawn from the server's token
 * positions, so two browsers can never disagree about the race.
 */
export function LudoBoard({
  players,
  myUserId,
  legal,
  onMove,
  className,
}: LudoBoardProps) {
  const me = players.find((player) => player.userId === myUserId) ?? null
  const movable = new Map<number, number>()
  if (me && legal) {
    for (const move of legal.moves) {
      movable.set(move.tokenId, move.steps)
    }
  }

  // Where each movable token would land — one hint per destination cell.
  const targets: LudoCell[] = []
  if (me) {
    const seen = new Set<string>()
    for (const [tokenId, steps] of movable) {
      const point = tokenPoint(me.quadrant, steps, tokenId, 0)
      const key = `${point.x.toFixed(2)}:${point.y.toFixed(2)}`
      if (seen.has(key)) continue
      seen.add(key)
      targets.push(point)
    }
  }

  // Tokens sharing a square are nudged apart, in a stable order.
  const stacks = new Map<string, number>()
  const draw = (player: LudoPlayer, tokenId: number) => {
    const steps = player.tokens[tokenId] ?? -1
    const key =
      steps < 0
        ? `base-${player.quadrant}-${tokenId}`
        : steps >= LUDO_HOME_STEP
          ? `home-${player.quadrant}-${tokenId}`
          : steps >= LUDO_HOME_COLUMN_START
            ? `column-${player.quadrant}-${steps}`
            : `track-${(LUDO_START_INDEX[player.quadrant] + steps) % LUDO_TRACK.length}`
    const index = stacks.get(key) ?? 0
    stacks.set(key, index + 1)

    const point = tokenPoint(player.quadrant, steps, tokenId, index)
    const color = LUDO_COLORS[player.quadrant]
    const canMove = me != null && player.userId === me.userId && movable.has(tokenId)
    const radius = steps >= LUDO_HOME_STEP ? 0.2 : 0.3

    return (
      <g
        key={`${player.userId}-${tokenId}`}
        data-testid={canMove ? 'ludo-token-movable' : 'ludo-token'}
        data-token={tokenId}
        data-user={player.userId}
        onClick={canMove ? () => onMove(tokenId) : undefined}
        className={canMove ? 'cursor-pointer' : undefined}
        style={{ pointerEvents: canMove ? 'auto' : 'none' }}
      >
        {canMove && (
          <circle
            cx={point.x}
            cy={point.y}
            r={radius + 0.22}
            fill={color}
            opacity={0.35}
            className="animate-pulse"
          />
        )}
        <circle
          cx={point.x}
          cy={point.y}
          r={radius}
          fill={color}
          stroke={TOKEN_EDGE}
          strokeWidth={0.07}
        />
        {canMove && (
          <circle
            cx={point.x}
            cy={point.y}
            r={radius + 0.1}
            fill="none"
            stroke="#ffffff"
            strokeWidth={0.07}
            opacity={0.9}
          />
        )}
      </g>
    )
  }

  const stationary = players.flatMap((player) =>
    player.tokens.map((_, tokenId) => ({ player, tokenId })),
  )
  // Movable tokens are painted last so a tap always hits the one you want.
  const ordered = [
    ...stationary.filter(
      ({ player, tokenId }) =>
        !(me != null && player.userId === me.userId && movable.has(tokenId)),
    ),
    ...stationary.filter(
      ({ player, tokenId }) =>
        me != null && player.userId === me.userId && movable.has(tokenId),
    ),
  ]

  return (
    <svg
      viewBox="0 0 15 15"
      className={cn('h-full w-full', className)}
      role="img"
      aria-label="Ludo board"
    >
      <rect
        x={0}
        y={0}
        width={15}
        height={15}
        rx={0.7}
        fill={BOARD_BG}
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={0.06}
      />

      {LUDO_BASE_ORIGIN.map((origin, quadrant) => (
        <g key={`base-${quadrant}`}>
          <rect
            x={origin.x + 0.25}
            y={origin.y + 0.25}
            width={5.5}
            height={5.5}
            rx={0.8}
            fill={LUDO_COLORS[quadrant]}
            fillOpacity={0.13}
            stroke={LUDO_COLORS[quadrant]}
            strokeOpacity={0.45}
            strokeWidth={0.07}
          />
          {LUDO_BASE_SLOTS.map((slot, slotIndex) => (
            <circle
              key={slotIndex}
              cx={origin.x + slot.x}
              cy={origin.y + slot.y}
              r={0.62}
              fill="none"
              stroke={LUDO_COLORS[quadrant]}
              strokeOpacity={0.35}
              strokeWidth={0.05}
            />
          ))}
        </g>
      ))}

      {LUDO_TRACK.map((cell, index) => {
        const startQuadrant = LUDO_START_INDEX.indexOf(index)
        const safe = LUDO_SAFE_CELLS.has(index)
        return (
          <g key={`track-${index}`}>
            <rect
              x={cell.x + 0.06}
              y={cell.y + 0.06}
              width={0.88}
              height={0.88}
              rx={0.18}
              fill={startQuadrant >= 0 ? LUDO_COLORS[startQuadrant] : CELL_FILL}
              fillOpacity={startQuadrant >= 0 ? 0.42 : 1}
              stroke={CELL_STROKE}
              strokeWidth={0.04}
            />
            {safe && startQuadrant < 0 && (
              <path
                d={`M ${cell.x + 0.5} ${cell.y + 0.29} L ${cell.x + 0.71} ${cell.y + 0.5} L ${cell.x + 0.5} ${cell.y + 0.71} L ${cell.x + 0.29} ${cell.y + 0.5} Z`}
                fill="#ffffff"
                fillOpacity={0.26}
              />
            )}
          </g>
        )
      })}

      {LUDO_HOME_COLUMN.map((cells, quadrant) =>
        cells.map((cell, index) => (
          <rect
            key={`column-${quadrant}-${index}`}
            x={cell.x + 0.06}
            y={cell.y + 0.06}
            width={0.88}
            height={0.88}
            rx={0.18}
            fill={LUDO_COLORS[quadrant]}
            fillOpacity={0.5}
            stroke={LUDO_COLORS[quadrant]}
            strokeOpacity={0.35}
            strokeWidth={0.04}
          />
        )),
      )}

      {/* Middle of the board: one home triangle per colour. */}
      <path d="M6 6 L9 6 L7.5 7.5 Z" fill={LUDO_COLORS[1]} fillOpacity={0.72} />
      <path d="M9 6 L9 9 L7.5 7.5 Z" fill={LUDO_COLORS[2]} fillOpacity={0.72} />
      <path d="M9 9 L6 9 L7.5 7.5 Z" fill={LUDO_COLORS[3]} fillOpacity={0.72} />
      <path d="M6 9 L6 6 L7.5 7.5 Z" fill={LUDO_COLORS[0]} fillOpacity={0.72} />
      <rect
        x={6}
        y={6}
        width={3}
        height={3}
        rx={0.2}
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={0.06}
      />

      {targets.map((point, index) => (
        <circle
          key={`target-${index}`}
          cx={point.x}
          cy={point.y}
          r={0.36}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.6}
          strokeWidth={0.06}
        />
      ))}

      {ordered.map(({ player, tokenId }) => draw(player, tokenId))}
    </svg>
  )
}
