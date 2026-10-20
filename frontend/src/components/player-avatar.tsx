import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { PlayerStatusDot } from '@/components/player-status-dot'
import { initials } from '@/lib/format'
import type { FriendStatus } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * A face with the presence light tucked into its corner — the form the
 * friends list, search results and the invite dialog all use.
 */
export function PlayerAvatar({
  name,
  status,
  className,
}: {
  name: string
  status: FriendStatus
  className?: string
}) {
  return (
    <span className="relative shrink-0">
      <Avatar className={cn('size-9', className)}>
        <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
      </Avatar>
      <PlayerStatusDot
        status={status}
        className="absolute -right-0.5 -bottom-0.5 ring-background"
      />
    </span>
  )
}
