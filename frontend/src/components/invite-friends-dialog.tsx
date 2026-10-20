import { useCallback, useEffect, useState } from 'react'
import {
  CheckIcon,
  ClockIcon,
  Loader2Icon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PlayerAvatar } from '@/components/player-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage, invitesApi } from '@/lib/api'
import { useSocial } from '@/lib/social-context'
import type { Friend } from '@/lib/types'

/**
 * The room menu's invite surface: every friend, with the ones already at the
 * table or already invited switched off. Invites are friends-only, so the
 * empty state points at the friends page.
 */
export function InviteFriendsDialog({
  tableId,
  seatedUserIds,
  open,
  onOpenChange,
}: {
  tableId: number
  /** Everyone holding a seat right now — they cannot be invited. */
  seatedUserIds: number[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { friends, loading, refresh } = useSocial()
  /**
   * The table's open invites, stamped with the table they belong to. `null`
   * means "not read yet" — buttons wait instead of offering a duplicate send.
   */
  const [pending, setPending] = useState<{
    tableId: number
    ids: Set<number>
  } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  // Every open of the dialog re-reads both sides: the friend list may have
  // grown, and someone else at the table may have invited since last time.
  const loadInvited = useCallback(() => {
    if (!open) return
    void refresh()
    invitesApi
      .listForTable(tableId)
      .then((list) =>
        setPending({
          tableId,
          ids: new Set(list.map((invite) => invite.inviteeId)),
        }),
      )
      .catch(() => setPending({ tableId, ids: new Set() }))
  }, [open, tableId, refresh])

  useEffect(() => {
    loadInvited()
  }, [loadInvited])

  const seated = new Set(seatedUserIds)
  const invitedIds = pending?.tableId === tableId ? pending.ids : null

  async function handleInvite(friend: Friend) {
    setBusyId(friend.id)
    try {
      const list = await invitesApi.send(tableId, friend.id)
      setPending({
        tableId,
        ids: new Set(list.map((invite) => invite.inviteeId)),
      })
      toast.success(`Invite sent to ${friend.displayName}`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not send the invite.'))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite friends</DialogTitle>
          <DialogDescription>
            Only friends can be invited. They get a notification with a Join
            button and land straight at this table.
          </DialogDescription>
        </DialogHeader>

        {loading && friends.length === 0 ? (
          <div className="space-y-2">
            <Skeleton className="h-14 rounded-xl" />
            <Skeleton className="h-14 rounded-xl" />
          </div>
        ) : friends.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <UsersIcon className="size-8 text-muted-foreground" />
            <p className="font-medium">No friends to invite yet</p>
            <p className="text-sm text-muted-foreground">
              Add players by name or phone number, then come back to this table
              and pull them in.
            </p>
            <Button asChild className="mt-1">
              <Link to="/friends" onClick={() => onOpenChange(false)}>
                Find players
              </Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2">
            {friends.map((friend) => {
              const isSeated = seated.has(friend.id)
              const isInvited = invitedIds?.has(friend.id) ?? false
              return (
                <li
                  key={friend.id}
                  className="flex items-center gap-3 rounded-xl border p-3"
                >
                  <PlayerAvatar
                    name={friend.displayName}
                    status={friend.status}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {friend.displayName}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {friend.status === 'online'
                        ? 'Online'
                        : 'Away right now'}
                    </p>
                  </div>
                  {isSeated ? (
                    <Badge variant="secondary" className="gap-1">
                      <CheckIcon />
                      At the table
                    </Badge>
                  ) : isInvited ? (
                    <Badge variant="outline" className="gap-1">
                      <ClockIcon />
                      Invited
                    </Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === friend.id || invitedIds === null}
                      onClick={() => void handleInvite(friend)}
                    >
                      {busyId === friend.id ? (
                        <Loader2Icon className="animate-spin" />
                      ) : (
                        <UserPlusIcon />
                      )}
                      Invite
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
