import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  DicesIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  UserPlusIcon,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { InviteFriendsDialog } from '@/components/invite-friends-dialog'
import { RoomWaitingActions } from '@/components/room-waiting-actions'
import { RoomConnectionStatus } from '@/components/room-connection-status'
import { PlayerWalletBadge } from '@/components/player-wallet-badge'
import { LudoBoard } from '@/components/ludo-board'
import { LudoSeat, type LudoSeatPlayer } from '@/components/ludo-seat'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getApiErrorMessage,
  getApiStatus,
  tablesApi,
  type TableActionType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { LUDO_COLORS } from '@/lib/ludo'
import type { TableDetails } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLiveTable } from '@/lib/use-live-table'

/** Ludo turns arrive through live invalidation and deadline wakeups. */

/**
 * The room is laid out at this design size and scaled down as one unit, the
 * same trick the poker table uses, so the board can never spill over the
 * controls and the action buttons stay visible on any screen.
 */
const DESIGN_BOARD = 366
const DESIGN_STRIP = 54
const DESIGN_LEGEND = 24
const DESIGN_GAP = 10
const DESIGN_WIDTH = DESIGN_BOARD
const DESIGN_HEIGHT =
  DESIGN_STRIP + DESIGN_GAP + DESIGN_BOARD + DESIGN_GAP + DESIGN_LEGEND

const PIPS: Record<number, Array<[number, number]>> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
}

/** The dice, showing the roll that is waiting or the last one played. */
function Die({
  value,
  active,
  pending,
}: {
  value: number | null
  active: boolean
  pending: boolean
}) {
  const pips = value == null ? [] : (PIPS[value] ?? [])
  return (
    <div
      data-testid="dice"
      data-value={value ?? ''}
      className={cn(
        'flex size-14 shrink-0 items-center justify-center rounded-2xl border bg-background shadow-inner transition-colors',
        active ? 'border-amber-400 ring-2 ring-amber-400/40' : 'border-border',
        pending && 'opacity-60',
      )}
    >
      {value == null ? (
        <DicesIcon className="size-6 text-muted-foreground" />
      ) : (
        <div
          key={value}
          className="grid animate-in grid-cols-3 grid-rows-3 gap-[3px] zoom-in-50 duration-200"
        >
          {Array.from({ length: 9 }, (_, index) => {
            const x = index % 3
            const y = Math.floor(index / 3)
            const filled = pips.some(([px, py]) => px === x && py === y)
            return (
              <span
                key={index}
                className={cn(
                  'size-2 rounded-full',
                  filled ? 'bg-foreground' : 'bg-transparent',
                )}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export function LudoRoomPage() {
  const { slug = 'ludo', tableId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [table, setTable] = useState<TableDetails | null>(null)
  /** When the latest table snapshot arrived (for the turn timer). */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [boardZoom, setBoardZoom] = useState(1)
  const areaRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)
  const shownResultRef = useRef('init')

  const game = table?.game.kind === 'ludo' ? table.game : null
  const seats = table?.seats ?? []
  const mySeat = seats.find((seat) => seat.userId === user?.id)
  const phase = game?.phase ?? 'waiting'
  const isPlaying = phase === 'playing'
  const isFinished = phase === 'finished'
  const legal = game?.legal ?? null
  const isMyTurn = isPlaying && legal != null

  // Scale the whole room down to fit: board, seats and legend shrink together.
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const measure = () => {
      const width = area.clientWidth - 24
      const height = area.clientHeight - 24
      setBoardZoom(
        Math.max(
          0.2,
          Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT, 1.3),
        ),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(interval)
  }, [])

  const backToLobby = useCallback(
    () => navigate(`/play/${slug}`, { replace: true }),
    [navigate, slug],
  )

  const applyTable = useCallback(
    (details: TableDetails) => {
      // A shared link can name the wrong game for this table
      // (`/play/ludo/table/<poker id>`). Follow the table's own game instead
      // of drawing it through the wrong room's UI.
      if (details.gameSlug !== slug) {
        navigate(`/play/${details.gameSlug}/table/${details.id}`, {
          replace: true,
        })
        return
      }
      setTable(details)
      setFetchedAt(Date.now())
    },
    [navigate, slug],
  )

  // Entering a Ludo table takes a seat (joining twice just keeps yours).
  useEffect(() => {
    let cancelled = false
    tablesApi
      .join(tableId)
      .then((details) => {
        if (!cancelled) applyTable(details)
      })
      .catch((error) => {
        if (cancelled) return
        toast.error(getApiErrorMessage(error, 'Could not enter this table.'))
        backToLobby()
      })
    return () => {
      cancelled = true
    }
  }, [tableId, applyTable, backToLobby])

  const refresh = useCallback(async () => {
    const seq = ++requestSeqRef.current
    try {
      const details = await tablesApi.get(tableId)
      if (seq === requestSeqRef.current) applyTable(details)
    } catch (error) {
      if (getApiStatus(error) === 404) {
        toast.error('This table no longer exists.')
        backToLobby()
      }
    }
  }, [tableId, applyTable, backToLobby])

  useLiveTable(tableId, refresh, game?.turnDeadline ?? null, game?.serverNow ?? null, fetchedAt)

  const sendAction = useCallback(
    async (action: { type: TableActionType; tokenId?: number }) => {
      const seq = ++requestSeqRef.current
      setPending(true)
      try {
        const details = await tablesApi.act(tableId, action)
        if (seq === requestSeqRef.current) applyTable(details)
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'That move did not work.'))
        void refresh()
      } finally {
        setPending(false)
      }
    },
    [tableId, applyTable, refresh],
  )

  async function handleLeave() {
    try {
      await tablesApi.leave(tableId)
    } catch {
      // Table may already be gone — still navigate back.
    }
    navigate(`/play/${slug}`, { replace: true })
  }

  const winnerName = seats.find(
    (seat) => seat.userId === game?.winnerUserId,
  )?.displayName
  const turnName = seats.find((seat) => seat.userId === game?.turnUserId)
    ?.displayName

  // Announce the winner once per game (never for history on first load).
  useEffect(() => {
    if (!game || game.phase !== 'finished' || game.winnerUserId == null) return
    const key = `t${table?.id}:g${game.gameNumber}`
    if (shownResultRef.current === 'init') {
      shownResultRef.current = key
      return
    }
    if (shownResultRef.current === key) return
    shownResultRef.current = key
    toast.success(winnerName ? `${winnerName} won the race!` : 'Race over')
  }, [game, table?.id, winnerName])

  // A gentle nudge when it is your turn.
  useEffect(() => {
    if (isMyTurn) {
      toast.info('Your turn', { id: 'ludo-your-turn-toast' })
    } else {
      toast.dismiss('ludo-your-turn-toast')
    }
  }, [isMyTurn])

  const secondsLeft =
    game?.turnDeadline != null
      ? Math.max(
          0,
          Math.ceil(
            (game.turnDeadline - game.serverNow - (now - fetchedAt)) / 1000,
          ),
        )
      : null
  const showTimer = isPlaying && secondsLeft != null

  let statusText = ''
  if (table) {
    if (isPlaying) {
      if (isMyTurn) {
        statusText =
          legal?.dice != null
            ? `Your turn — move a token ${legal.dice}`
            : 'Your turn — roll the dice'
      } else if (turnName) {
        statusText = `Waiting for ${turnName}…`
      }
    } else if (isFinished) {
      statusText = winnerName
        ? `${winnerName} won the race — ready up for the next one.`
        : 'The race is over — ready up for the next one.'
    } else if (seats.length < 2) {
      statusText = 'Waiting for one more player to take a seat.'
    } else if (mySeat?.ready) {
      statusText = 'You are ready — waiting for the others.'
    } else {
      statusText = 'Everyone seated — tap Ready to race.'
    }
  }

  const playerBySeat = new Map(
    (game?.players ?? []).map((player) => [player.seatIndex, player]),
  )

  const seatCards = Array.from({ length: table?.maxSeats ?? 4 }, (_, index) => {
    const seat = seats.find((s) => s.seatIndex === index)
    if (!seat) return <LudoSeat key={index} />
    const player = playerBySeat.get(index)
    const seatPlayer: LudoSeatPlayer = {
      name: seat.displayName,
      color: player ? LUDO_COLORS[player.quadrant] : null,
      ready: seat.ready,
      status: seat.status,
      isTurn: game?.turnUserId === seat.userId,
      isYou: seat.userId === user?.id,
      home: player?.home ?? 0,
      inGame: player != null,
      winner: game?.winnerUserId === seat.userId,
    }
    return <LudoSeat key={index} player={seatPlayer} />
  })

  const canReady =
    mySeat != null && !mySeat.ready && seats.length >= 2 && !isPlaying
  const moveHint = isMyTurn && legal != null && legal.dice != null

  return (
    <div data-game="ludo" className="grid h-[100dvh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background room-side:grid-cols-[minmax(0,1fr)_minmax(240px,46%)] room-side:grid-rows-[auto_minmax(0,1fr)]">
      {/* Top bar */}
      <div className="room-topbar flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2.5 room-side:col-span-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/play/${slug}`} aria-label="Back to tables">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex flex-1 flex-col items-center">
          <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Timer
          </span>
          <span
            className={cn(
              'text-xl leading-tight font-semibold tabular-nums',
              showTimer && secondsLeft != null && secondsLeft <= 10
                ? 'text-red-400'
                : undefined,
            )}
          >
            {showTimer ? `${secondsLeft}s` : '—'}
          </span>
        </div>
        <PlayerWalletBadge />
        <RoomConnectionStatus />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Table menu">
              <EllipsisVerticalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="truncate">{table?.name ?? 'Table'}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {table
                    ? `${table.seats.length} · ${table.maxSeats} seated · Ludo`
                    : 'Loading…'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled>
              <MessageCircleIcon />
              Table chat (soon)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setInviteOpen(true)}>
              <UserPlusIcon />
              Invite friends
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleLeave}>
              <LogOutIcon />
              Leave table
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {table && (
          <InviteFriendsDialog
            tableId={table.id}
            seatedUserIds={table.seats.map((seat) => seat.userId)}
            open={inviteOpen}
            onOpenChange={setInviteOpen}
          />
        )}
      </div>

      {/* Board area — absorbs the leftover height, the room scales to fit */}
      <div
        ref={areaRef}
        className="room-board-area relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 room-side:col-start-1 room-side:row-start-2"
      >
        {table === null ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <div
            className="flex flex-col items-center"
            style={{ zoom: boardZoom, gap: DESIGN_GAP, width: DESIGN_WIDTH }}
          >
            <div
              data-testid="ludo-seats"
              className="grid w-full gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${table.maxSeats}, minmax(0, 1fr))`,
                height: DESIGN_STRIP,
              }}
            >
              {seatCards}
            </div>
            <div
              className="relative shrink-0"
              style={{ width: DESIGN_BOARD, height: DESIGN_BOARD }}
            >
              <LudoBoard
                players={game?.players ?? []}
                myUserId={user?.id ?? null}
                legal={legal}
                onMove={(tokenId) => void sendAction({ type: 'move', tokenId })}
              />
            </div>
            <p
              data-testid="ludo-legend"
              className="text-center text-[11px] leading-[1.4] text-muted-foreground"
            >
              6 leaves the base · ★ squares are safe · an exact roll comes home
            </p>
          </div>
        )}
      </div>

      {/* Dice + controls — under the board in portrait, beside it when the
          screen is wide but short, so the board can use the full height */}
      <div className="room-controls-panel shrink-0 border-t bg-card px-4 pt-3 pb-5 room-side:col-start-2 room-side:row-start-2 room-side:flex room-side:items-center room-side:border-t-0 room-side:border-l room-side:py-3">
        <div
          className="mx-auto flex w-full max-w-[420px] flex-col gap-3"
          data-testid="controls"
        >
          <div className="flex items-center gap-3">
            <Die
              value={game?.dice ?? game?.lastRoll ?? null}
              active={isMyTurn}
              pending={pending}
            />
            <div className="min-w-0 flex-1">
              <p
                data-testid="status"
                className={cn(
                  'text-sm',
                  isMyTurn
                    ? 'font-semibold text-amber-400'
                    : 'text-muted-foreground',
                )}
              >
                {statusText}
              </p>
              {moveHint && (
                <p className="text-xs text-muted-foreground">
                  Tap one of your highlighted tokens on the board.
                </p>
              )}
            </div>
          </div>

          {isPlaying ? (
            isMyTurn && legal?.roll ? (
              <Button
                className="w-full"
                size="lg"
                disabled={pending}
                onClick={() => void sendAction({ type: 'roll' })}
                data-testid="roll"
              >
                Roll the dice
              </Button>
            ) : isMyTurn ? (
              <div className="rounded-xl border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground">
                Pick a token to move {legal?.dice}
              </div>
            ) : (
              <Button className="w-full" variant="outline" disabled>
                Waiting for {turnName ?? 'the other player'}…
              </Button>
            )
          ) : seats.length < 2 ? (
            <RoomWaitingActions onInvite={() => setInviteOpen(true)} />
          ) : (
            <Button
              className="w-full"
              size="lg"
              data-testid="ready"
              disabled={pending || !canReady}
              onClick={() => void sendAction({ type: 'ready' })}
            >
              {mySeat?.ready
                ? 'Ready — waiting for the others'
                : isFinished
                  ? 'Ready for a rematch'
                  : 'Ready'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
