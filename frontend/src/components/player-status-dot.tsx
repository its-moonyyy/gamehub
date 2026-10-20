import type { SeatStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

const STATUS_META: Record<SeatStatus, { label: string; dot: string }> = {
  online: { label: 'Online', dot: 'bg-emerald-500' },
  offline: { label: 'Offline', dot: 'bg-red-500' },
  'not-ready': { label: 'Not ready', dot: 'bg-amber-500' },
}

/**
 * The presence light on a seat: green when the player is around, red when
 * they went quiet, amber while a game waits for them to ready up.
 */
export function PlayerStatusDot({
  status,
  className,
}: {
  status: SeatStatus
  className?: string
}) {
  const meta = STATUS_META[status]

  return (
    <span
      role="img"
      aria-label={meta.label}
      title={meta.label}
      data-status={status}
      className={cn(
        'inline-block size-2 shrink-0 rounded-full ring-2 ring-black/40',
        meta.dot,
        className,
      )}
    />
  )
}
