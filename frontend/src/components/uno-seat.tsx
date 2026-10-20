import { UserPlusIcon } from 'lucide-react'
import { PlayerStatusDot } from '@/components/player-status-dot'
import type { SeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface UnoSeatPlayer {
  name: string
  ready: boolean
  /** Presence: green online, red offline, amber not ready. */
  status: SeatStatus
  isTurn: boolean
  isYou: boolean
  /** Cards left in this player's hand. */
  cardCount: number
  /** The player is part of the running game (not just seated waiting). */
  inGame: boolean
  winner: boolean
  /** One card left and UNO was called. */
  saidUno: boolean
  /** One card left without calling UNO — catch them! */
  pendingUno: boolean
}

/**
 * One seat of an Uno table, in the strip above the felt. Compact on purpose:
 * six of them sit side by side on a phone without pushing the table away.
 */
export function UnoSeat({ player }: { player?: UnoSeatPlayer }) {
  if (!player) {
    return (
      <div className="flex min-w-0 flex-col justify-center gap-0.5 rounded-xl border border-dashed border-white/15 bg-black/20 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <UserPlusIcon className="size-3 shrink-0 text-white/40" />
          <span className="truncate text-[11px] leading-tight text-white/50">
            Open seat
          </span>
        </div>
        <span className="truncate text-[10px] leading-tight text-white/40">
          Waiting…
        </span>
      </div>
    )
  }

  const subline = player.winner
    ? 'Winner'
    : player.pendingUno
      ? 'UNO missed!'
      : player.saidUno
        ? 'UNO!'
        : player.inGame
          ? `${player.cardCount} ${player.cardCount === 1 ? 'card' : 'cards'}`
          : player.ready
            ? 'Ready'
            : 'Not ready'

  return (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-center gap-0.5 rounded-xl border bg-card px-2 py-1.5',
        player.isTurn
          ? 'border-amber-400 ring-1 ring-amber-400/40'
          : player.isYou
            ? 'border-emerald-500/60'
            : 'border-border',
        player.pendingUno && 'border-red-400/80 ring-1 ring-red-400/40',
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            'size-2.5 shrink-0 rounded-full border border-black/30',
            player.inGame ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
        />
        <span className="truncate text-[11px] leading-tight font-semibold">
          {player.name}
        </span>
        {/* Presence light — pinned right so a long name cannot hide it. */}
        <PlayerStatusDot status={player.status} className="ml-auto" />
      </div>
      <span
        className={cn(
          'truncate text-[10px] leading-tight',
          player.pendingUno
            ? 'font-semibold text-red-300'
            : player.saidUno
              ? 'font-semibold text-amber-300'
              : player.isTurn
                ? 'text-amber-300'
                : 'text-muted-foreground',
        )}
      >
        {subline}
      </span>
    </div>
  )
}
