import type { CSSProperties } from 'react'
import { UserPlusIcon } from 'lucide-react'
import { PlayingCard } from '@/components/playing-card'
import { PlayerStatusDot } from '@/components/player-status-dot'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { formatMoney, initials } from '@/lib/format'
import type { SeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

export interface SeatPlayer {
  name: string
  /** Stack in cents. */
  money: number
  lastAction: string
  /** Presence: green online, red offline, amber not ready. */
  status?: SeatStatus
  /** Chips committed on this street, in cents. */
  bet?: number
  folded?: boolean
  /** The player is all-in — their stack is in the pot. */
  allIn?: boolean
  /** It is this player's turn to act. */
  isTurn?: boolean
  /**
   * Hole cards this viewer may see — their own hand, or anyone's hand
   * revealed at showdown. They render inside the seat, where the avatar
   * would be, so every player's cards sit clearly with their owner.
   */
  cards?: string[] | null
}

interface PokerSeatProps {
  style: CSSProperties
  player?: SeatPlayer
  isYou?: boolean
}

export function PokerSeat({ style, player, isYou }: PokerSeatProps) {
  const base =
    'absolute flex aspect-[104/140] w-[25.2%] flex-col items-center justify-center gap-1.5 rounded-2xl p-2 text-center shadow-lg'

  if (!player) {
    return (
      <div
        style={style}
        className={cn(
          base,
          'border border-dashed border-white/15 bg-black/20 shadow-none',
        )}
      >
        <UserPlusIcon className="size-4 text-white/40" />
        <span className="text-[10px] leading-tight text-white/50">
          Open seat
        </span>
      </div>
    )
  }

  const revealed =
    player.cards && player.cards.length > 0 ? player.cards : null
  const bet = player.bet != null && player.bet > 0 ? player.bet : null

  return (
    <div
      style={style}
      className={cn(
        base,
        'border bg-card',
        player.isTurn
          ? 'border-amber-400 ring-2 ring-amber-400/40'
          : isYou
            ? 'border-emerald-500/60 ring-2 ring-emerald-500/20'
            : 'border-border',
        player.folded && 'opacity-50 grayscale',
      )}
    >
      {/* Hole cards sit in the seat itself, in the avatar's place */}
      {revealed ? (
        <div className="flex items-center gap-1" data-testid="seat-cards">
          {revealed.map((card, index) => (
            <PlayingCard
              key={`${card}-${index}`}
              card={card}
              className="w-7"
            />
          ))}
        </div>
      ) : (
        <Avatar className="size-9">
          <AvatarFallback className="text-xs">
            {initials(player.name)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className="flex w-full flex-col items-center gap-0.5">
        <span className="flex w-full min-w-0 items-center justify-center gap-1">
          {player.status && <PlayerStatusDot status={player.status} />}
          <span className="truncate text-[11px] leading-tight font-medium">
            {player.name}
          </span>
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatMoney(player.money)}
        </span>
      </div>
      <Badge
        data-testid="seat-action"
        variant={isYou ? 'default' : 'secondary'}
        className="max-w-full truncate text-[9px]"
      >
        {player.allIn ? 'All-in' : player.lastAction}
      </Badge>

      {/* Chips committed this street */}
      {bet != null && (
        <span className="absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full border border-white/25 bg-black/75 px-1.5 py-0.5 text-[9px] leading-none font-semibold text-white tabular-nums shadow">
          {formatMoney(bet)}
        </span>
      )}
    </div>
  )
}
