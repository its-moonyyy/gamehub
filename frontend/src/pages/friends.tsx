import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  MailIcon,
  SearchIcon,
  UserMinusIcon,
  UserPlusIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { PlayerAvatar } from '@/components/player-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { friendsApi, getApiErrorMessage } from '@/lib/api'
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
import { useSocial } from '@/lib/social-context'
import type {
  Friend,
  FriendRequestInfo,
  PlayerSearchResult,
  TableInvite,
} from '@/lib/types'

/** Shorter queries match too much; the API agrees on the same minimum. */
const SEARCH_MIN_LENGTH = 2
const SEARCH_DEBOUNCE_MS = 300

/** Icons come from the catalog's icon keys; the invite payload has slugs. */
const GAME_ICON_BY_SLUG: Record<string, LucideIcon> = {
  poker: GAME_ICONS.spade,
  ludo: GAME_ICONS.dice,
  dominoes: GAME_ICONS.domino,
  uno: GAME_ICONS.layers,
}

const ROW_MOTION = {
  layout: true,
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: 0.18, ease: 'easeOut' as const },
}

/** "Last seen 3h ago" — presence detail for friends who are not online. */
function lastSeenLabel(lastSeenAt: string | null): string {
  if (!lastSeenAt) return 'Offline'
  const minutes = Math.floor(
    (Date.now() - new Date(lastSeenAt).getTime()) / 60_000,
  )
  if (minutes < 1) return 'Seen just now'
  if (minutes < 60) return `Last seen ${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Last seen ${hours}h ago`
  return `Last seen ${Math.floor(hours / 24)}d ago`
}

function RowShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      {children}
    </div>
  )
}

export function FriendsPage() {
  const {
    friends,
    incoming,
    outgoing,
    invites,
    loading,
    sendRequest,
    acceptRequest,
    declineRequest,
    cancelRequest,
    removeFriend,
    acceptInvite,
    declineInvite,
  } = useSocial()

  const [query, setQuery] = useState('')
  /** Results stamped with the text that produced them, so a stale answer
      can never be shown for a newer query. */
  const [found, setFound] = useState<{
    query: string
    players: PlayerSearchResult[]
  } | null>(null)
  /** The one action in flight, e.g. `add-3` — every other button stays live. */
  const [busy, setBusy] = useState<string | null>(null)

  const text = query.trim()
  const results = found?.query === text ? found.players : null
  const searching = text.length >= SEARCH_MIN_LENGTH && results === null

  // Search as you type, one request per pause.
  useEffect(() => {
    const search = query.trim()
    if (search.length < SEARCH_MIN_LENGTH) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      friendsApi
        .search(search)
        .then((players) => {
          if (!cancelled) setFound({ query: search, players })
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setFound({ query: search, players: [] })
            toast.error(getApiErrorMessage(error, 'Search failed.'))
          }
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query])

  /** Marks a search result's relation in place, so the button flips at once. */
  function patchResult(
    userId: number,
    patch: Partial<Pick<PlayerSearchResult, 'relation' | 'requestId'>>,
  ) {
    setFound((current) =>
      current
        ? {
            ...current,
            players: current.players.map((result) =>
              result.id === userId ? { ...result, ...patch } : result,
            ),
          }
        : null,
    )
  }

  async function run(
    key: string,
    action: () => Promise<unknown>,
    success: string,
  ) {
    setBusy(key)
    try {
      await action()
      toast.success(success)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Something went wrong.'))
    } finally {
      setBusy(null)
    }
  }

  function handleAdd(result: PlayerSearchResult) {
    void run(
      `add-${result.id}`,
      async () => {
        await sendRequest(result.id)
        patchResult(result.id, { relation: 'outgoing', requestId: null })
      },
      `Friend request sent to ${result.displayName}`,
    )
  }

  function handleAcceptSearch(result: PlayerSearchResult) {
    if (result.requestId == null) return
    void run(
      `accept-search-${result.id}`,
      async () => {
        await acceptRequest(result.requestId!)
        patchResult(result.id, { relation: 'friends', requestId: null })
      },
      `You and ${result.displayName} are friends now`,
    )
  }

  function handleAcceptRequest(request: FriendRequestInfo) {
    void run(
      `accept-${request.id}`,
      () => acceptRequest(request.id),
      `You and ${request.displayName} are friends now`,
    )
  }

  function handleDeclineRequest(request: FriendRequestInfo) {
    void run(
      `decline-${request.id}`,
      () => declineRequest(request.id),
      'Friend request declined',
    )
  }

  function handleCancelRequest(request: FriendRequestInfo) {
    void run(
      `cancel-${request.id}`,
      () => cancelRequest(request.id),
      'Friend request taken back',
    )
  }

  function handleRemoveFriend(friend: Friend) {
    void run(
      `remove-${friend.id}`,
      () => removeFriend(friend.id),
      `${friend.displayName} removed from your friends`,
    )
  }

  async function handleJoin(invite: TableInvite) {
    // The context toasts and navigates — this only reports failures.
    setBusy(`join-${invite.id}`)
    try {
      await acceptInvite(invite.id)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not join this table.'))
    } finally {
      setBusy(null)
    }
  }

  function handleDeclineInvite(invite: TableInvite) {
    void run(
      `invite-decline-${invite.id}`,
      () => declineInvite(invite.id),
      'Invitation declined',
    )
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Friends</h1>
        <p className="text-sm text-muted-foreground">
          Add players by name or phone number, then pull them into your table
          when the seats are open.
        </p>
      </div>

      {/* Find players */}
      <Card>
        <CardHeader>
          <CardTitle>Add a player</CardTitle>
          <CardDescription>
            They see your request on their side and can accept it whenever they
            are around.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Display name or phone number"
              className="pl-9"
              aria-label="Search players"
            />
          </div>

          {searching ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : results === null ? (
            <p className="text-xs text-muted-foreground">
              Type at least {SEARCH_MIN_LENGTH} characters to search.
            </p>
          ) : results.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No players match that. Check the spelling, or try their phone
              number.
            </p>
          ) : (
            <ul className="space-y-2">
              {results.map((result) => (
                <li key={result.id}>
                  <RowShell>
                    <PlayerAvatar
                      name={result.displayName}
                      status={result.status}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {result.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {result.phoneNumber}
                      </p>
                    </div>
                    {result.relation === 'friends' ? (
                      <Badge variant="secondary" className="gap-1">
                        <CheckIcon />
                        Friends
                      </Badge>
                    ) : result.relation === 'outgoing' ? (
                      <Button variant="outline" size="sm" disabled>
                        <ClockIcon />
                        Requested
                      </Button>
                    ) : result.relation === 'incoming' ? (
                      <Button
                        size="sm"
                        disabled={busy === `accept-search-${result.id}`}
                        onClick={() => handleAcceptSearch(result)}
                      >
                        {busy === `accept-search-${result.id}` ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <CheckIcon />
                        )}
                        Accept
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy === `add-${result.id}`}
                        onClick={() => handleAdd(result)}
                      >
                        {busy === `add-${result.id}` ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <UserPlusIcon />
                        )}
                        Add friend
                      </Button>
                    )}
                  </RowShell>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Table invites — the time-sensitive part, so it sits high on the page */}
      {invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MailIcon className="size-4 text-muted-foreground" />
              Table invites
              <Badge className="rounded-full">{invites.length}</Badge>
            </CardTitle>
            <CardDescription>
              Friends are holding a seat for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {invites.map((invite) => {
                  const Icon =
                    GAME_ICON_BY_SLUG[invite.gameSlug] ?? FALLBACK_GAME_ICON
                  return (
                    <motion.li
                      key={invite.id}
                      {...ROW_MOTION}
                      className="flex items-center gap-3 rounded-xl border p-3"
                    >
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {invite.tableName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {invite.gameName} · from {invite.inviterName} ·{' '}
                          {invite.seatedCount} of {invite.maxSeats} seats taken
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          size="sm"
                          disabled={busy === `join-${invite.id}`}
                          onClick={() => void handleJoin(invite)}
                        >
                          {busy === `join-${invite.id}` ? (
                            <Loader2Icon className="animate-spin" />
                          ) : (
                            <ArrowRightIcon />
                          )}
                          Join
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === `invite-decline-${invite.id}`}
                          onClick={() => handleDeclineInvite(invite)}
                        >
                          Decline
                        </Button>
                      </div>
                    </motion.li>
                  )
                })}
              </AnimatePresence>
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Requests, when there are any */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Requests</CardTitle>
            <CardDescription>
              Answer the ones addressed to you, or take back the ones you sent.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <AnimatePresence initial={false}>
              {incoming.map((request) => (
                <motion.div key={`in-${request.id}`} {...ROW_MOTION}>
                  <RowShell>
                    <PlayerAvatar
                      name={request.displayName}
                      status={request.status}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {request.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        Wants to be friends
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Button
                        size="sm"
                        disabled={busy === `accept-${request.id}`}
                        onClick={() => handleAcceptRequest(request)}
                      >
                        {busy === `accept-${request.id}` ? (
                          <Loader2Icon className="animate-spin" />
                        ) : (
                          <CheckIcon />
                        )}
                        Accept
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === `decline-${request.id}`}
                        onClick={() => handleDeclineRequest(request)}
                      >
                        <XIcon />
                        Decline
                      </Button>
                    </div>
                  </RowShell>
                </motion.div>
              ))}

              {outgoing.map((request) => (
                <motion.div key={`out-${request.id}`} {...ROW_MOTION}>
                  <RowShell>
                    <PlayerAvatar
                      name={request.displayName}
                      status={request.status}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {request.displayName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        Request sent · waiting for them
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy === `cancel-${request.id}`}
                      onClick={() => handleCancelRequest(request)}
                    >
                      Cancel
                    </Button>
                  </RowShell>
                </motion.div>
              ))}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      {/* The friends themselves */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Friends
            <Badge variant="secondary" className="rounded-full">
              {friends.length}
            </Badge>
          </CardTitle>
          <CardDescription>
            Green means they are around right now — invite them from any table
            room.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && friends.length === 0 ? (
            <div className="space-y-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
          ) : friends.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <UsersIcon className="size-8 text-muted-foreground" />
              <p className="font-medium">No friends yet</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Search above to add someone. Once you are friends, you can
                invite them to any table you are sitting at.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {friends.map((friend) => (
                  <motion.li
                    key={friend.id}
                    {...ROW_MOTION}
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
                        {friend.phoneNumber} ·{' '}
                        {friend.status === 'online'
                          ? 'Online'
                          : lastSeenLabel(friend.lastSeenAt)}
                      </p>
                    </div>
                    <Badge
                      variant={friend.status === 'online' ? 'default' : 'outline'}
                      className="hidden sm:inline-flex"
                    >
                      {friend.status === 'online' ? 'Ready to play' : 'Away'}
                    </Badge>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Actions for ${friend.displayName}`}
                        >
                          <EllipsisVerticalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={busy === `remove-${friend.id}`}
                          onSelect={() => handleRemoveFriend(friend)}
                        >
                          <UserMinusIcon />
                          Remove friend
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </CardContent>
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        Looking for someone? Share your number and have them add you — or{' '}
        <Link to="/play/poker" className="underline underline-offset-3">
          open a table
        </Link>{' '}
        and invite the friends you already have.
      </p>
    </div>
  )
}
