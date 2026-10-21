import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { friendsApi, getApiErrorMessage, invitesApi } from './api'
import { useAuth } from './auth-context'
import { subscribeGameEvents } from './game-events'
import { formatMoney } from './format'
import type {
  Friend,
  FriendRequestInfo,
  FriendsOverview,
  TableInvite,
} from './types'

/** Slow fallback while the event stream is reconnecting. */
const POLL_INTERVAL_MS = 30_000

/** Friends, requests and invites as one atom — stamped with whose they are. */
interface SocialState {
  userId: number
  overview: FriendsOverview
  invites: TableInvite[]
}

interface SocialContextValue {
  friends: Friend[]
  incoming: FriendRequestInfo[]
  outgoing: FriendRequestInfo[]
  invites: TableInvite[]
  /** True until the signed-in user's first payload arrives. */
  loading: boolean
  /** Incoming requests plus open table invites — what the navbar dots on. */
  pendingCount: number
  /** Re-reads friends and invites right now. */
  refresh: () => Promise<void>
  sendRequest: (userId: number) => Promise<void>
  acceptRequest: (requestId: number) => Promise<void>
  declineRequest: (requestId: number) => Promise<void>
  cancelRequest: (requestId: number) => Promise<void>
  removeFriend: (friendId: number) => Promise<void>
  /** Accepts an invite: seats you, then takes you to the room. */
  acceptInvite: (inviteId: number, entryFee: number | null) => Promise<void>
  declineInvite: (inviteId: number) => Promise<void>
}

const SocialContext = createContext<SocialContextValue | null>(null)

/**
 * Friends and table invites, kept in one place: the navbar badge and the
 * friends page read the same state, and a fresh invite announces itself in a
 * toast with a Join button wherever the user happens to be.
 */
export function SocialProvider({ children }: { children: ReactNode }) {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id ?? null
  /**
   * State carries the user it belongs to, so signing out — or switching
   * accounts — makes it invisible at render time instead of a frame later.
   */
  const [state, setState] = useState<SocialState | null>(null)
  /**
   * Invite ids already announced, per user. Seeded on the first load so a
   * backlog of invitations does not greet the user with a toast storm.
   */
  const announced = useRef<{ userId: number; ids: Set<number> } | null>(null)

  const current = state && state.userId === userId ? state : null

  const acceptInvite = useCallback(
    async (inviteId: number, entryFee: number | null) => {
      const details = await invitesApi.accept(inviteId, entryFee ?? undefined)
      void refreshUser().catch(() => {})
      setState((previous) =>
        previous
          ? {
              ...previous,
              invites: previous.invites.filter(
                (invite) => invite.id !== inviteId,
              ),
            }
          : previous,
      )
      toast.success(`Joined ${details.name}`)
      navigate(`/play/${details.gameSlug}/table/${details.id}`)
    },
    [navigate, refreshUser],
  )

  const joinFromToast = useCallback(
    (invite: TableInvite) => {
      void acceptInvite(invite.id, invite.entryFee).catch((error: unknown) => {
        toast.error(getApiErrorMessage(error, 'Could not join this table.'))
      })
    },
    [acceptInvite],
  )

  const load = useCallback(async () => {
    if (!userId) return
    try {
      const [overview, invites] = await Promise.all([
        friendsApi.overview(),
        invitesApi.listMine(),
      ])
      setState({ userId, overview, invites })

      const seen = announced.current
      if (!seen || seen.userId !== userId) {
        announced.current = {
          userId,
          ids: new Set(invites.map((invite) => invite.id)),
        }
      } else {
        const fresh = invites.find((invite) => !seen.ids.has(invite.id))
        for (const invite of invites) {
          seen.ids.add(invite.id)
        }
        if (fresh) {
          toast(`${fresh.inviterName} invited you to ${fresh.tableName}`, {
            description: `${fresh.gameName} · ${fresh.seatedCount} of ${fresh.maxSeats} seats taken · entry ${fresh.entryFee == null ? 'free' : formatMoney(fresh.entryFee)}`,
            duration: 12_000,
            action: { label: fresh.entryFee == null ? 'Join' : `Pay ${formatMoney(fresh.entryFee)}`, onClick: () => joinFromToast(fresh) },
          })
        }
      }
    } catch {
      // The badge is decoration; the friends page shows its own errors.
    }
  }, [userId, joinFromToast])

  // Poll while signed in, and jump on it as soon as the tab comes back.
  useEffect(() => {
    if (!userId) return
    void load()
    const unsubscribe = subscribeGameEvents((event) => {
      if (event.kind === 'invite' || event.kind === 'sync') void load()
    })
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, load])

  /** Applies an overview answer, keeping the user stamp intact. */
  const applyOverview = useCallback(
    (overview: FriendsOverview) => {
      setState((previous) =>
        previous ? { ...previous, overview } : previous,
      )
    },
    [],
  )

  // Every mutation answers with the viewer's fresh overview.
  const sendRequest = useCallback(
    async (targetId: number) => {
      applyOverview(await friendsApi.sendRequest(targetId))
    },
    [applyOverview],
  )

  const acceptRequest = useCallback(
    async (requestId: number) => {
      applyOverview(await friendsApi.acceptRequest(requestId))
    },
    [applyOverview],
  )

  const declineRequest = useCallback(
    async (requestId: number) => {
      applyOverview(await friendsApi.declineRequest(requestId))
    },
    [applyOverview],
  )

  const cancelRequest = useCallback(
    async (requestId: number) => {
      applyOverview(await friendsApi.cancelRequest(requestId))
    },
    [applyOverview],
  )

  const removeFriend = useCallback(
    async (friendId: number) => {
      applyOverview(await friendsApi.remove(friendId))
    },
    [applyOverview],
  )

  const declineInvite = useCallback(async (inviteId: number) => {
    await invitesApi.decline(inviteId)
    setState((previous) =>
      previous
        ? {
            ...previous,
            invites: previous.invites.filter(
              (invite) => invite.id !== inviteId,
            ),
          }
        : previous,
    )
  }, [])

  const value = useMemo<SocialContextValue>(
    () => ({
      friends: current?.overview.friends ?? [],
      incoming: current?.overview.incoming ?? [],
      outgoing: current?.overview.outgoing ?? [],
      invites: current?.invites ?? [],
      loading: Boolean(userId) && current === null,
      pendingCount:
        (current?.overview.incoming.length ?? 0) +
        (current?.invites.length ?? 0),
      refresh: load,
      sendRequest,
      acceptRequest,
      declineRequest,
      cancelRequest,
      removeFriend,
      acceptInvite,
      declineInvite,
    }),
    [
      userId,
      current,
      load,
      sendRequest,
      acceptRequest,
      declineRequest,
      cancelRequest,
      removeFriend,
      acceptInvite,
      declineInvite,
    ],
  )

  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  )
}

export function useSocial(): SocialContextValue {
  const context = useContext(SocialContext)
  if (!context) {
    throw new Error('useSocial must be used inside <SocialProvider>')
  }
  return context
}
