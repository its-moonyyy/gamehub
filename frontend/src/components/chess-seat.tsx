import { UserPlusIcon } from 'lucide-react'
import { PlayerStatusDot } from '@/components/player-status-dot'
import { formatClockMs } from '@/lib/chess'
import type { ChessColor, SeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface ChessSeatPlayer {
  name: string
  /** The side this player has once the game starts. */
  color: ChessColor | null
  ready: boolean
  /** Presence: green online, red offline, amber not ready. */
  status: SeatStatus
  isTurn: boolean
  isYou: boolean
  /** The player is part of the running game (not just seated waiting). */
  inGame: boolean
  winner: boolean
  /** The side's remaining clock in milliseconds, or null before a colour is drawn. */
  clockMs: number | null
}

/**
 * One seat of a chess table, in the strip above the board. Two of them sit
 * side by side: the white seat on the left, the black seat on the right.
 */
export function ChessSeat({ player }: { player?: ChessSeatPlayer }) {
  if (!player) {
    return (
      <div className="flex min-w-0 flex-col justify-center gap-0.5 rounded-xl border border-dashed border-border bg-card px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <UserPlusIcon className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            Open seat
          </span>
        </div>
        <span className="truncate text-[10px] leading-tight text-muted-foreground/70">
          Waiting…
        </span>
      </div>
    )
  }

  const side = player.color === 'w' ? 'White' : player.color === 'b' ? 'Black' : null
  const subline = player.winner
    ? 'Winner'
    : player.inGame
      ? side
        ? `${side}${player.isTurn ? ' · to move' : ''}`
        : 'Playing'
      : player.ready
        ? 'Ready'
        : 'Not ready'

  return (
    <div
      data-testid="chess-seat"
      className={cn(
        'flex min-w-0 flex-col justify-center gap-0.5 rounded-xl border bg-card px-2.5 py-1.5',
        player.isTurn
          ? 'border-amber-400 ring-1 ring-amber-400/40'
          : player.isYou
            ? 'border-emerald-500/60'
            : 'border-border',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'size-2.5 shrink-0 rounded-full',
            player.color === 'b'
              ? 'border border-white/25 bg-[#2b312c]'
              : 'bg-[#f5f0e1]',
          )}
        />
        <span className="truncate text-[11px] leading-tight font-semibold">
          {player.name}
        </span>
        {/* Presence light — pinned right so a long name cannot hide it. */}
        <PlayerStatusDot status={player.status} className="ml-auto" />
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'truncate text-[10px] leading-tight',
            player.isTurn ? 'text-amber-500' : 'text-muted-foreground',
          )}
        >
          {subline}
        </span>
        {/* The bank is what a chess player actually watches — keep it in the
            seat, next to the side it belongs to. */}
        {player.clockMs != null && (
          <span
            data-testid="chess-clock"
            className={cn(
              'ml-auto shrink-0 text-[11px] leading-tight font-semibold tabular-nums',
              player.clockMs < 20_000
                ? 'text-red-400'
                : player.isTurn
                  ? 'text-foreground'
                  : 'text-muted-foreground',
            )}
          >
            {formatClockMs(player.clockMs)}
          </span>
        )}
      </div>
    </div>
  )
}
