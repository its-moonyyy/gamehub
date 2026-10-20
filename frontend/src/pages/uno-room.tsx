import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  RepeatIcon,
  UserPlusIcon,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { InviteFriendsDialog } from '@/components/invite-friends-dialog'
import { UnoCardBack, UnoCardFace } from '@/components/uno-card'
import { UnoSeat, type UnoSeatPlayer } from '@/components/uno-seat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  tablesApi,
  type TableActionType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { TableDetails, UnoColor } from '@/lib/types'
import {
  keyedHand,
  UNO_COLORS,
  UNO_COLOR_HEX,
  UNO_COLOR_NAMES,
} from '@/lib/uno'
import { cn } from '@/lib/utils'

/** Uno turns are quick — poll often, but never while the tab is hidden. */
const POLL_INTERVAL_MS = 1200

/**
 * The room is laid out at this design size and scaled down as one unit, the
 * same trick the other game rooms use, so the felt can never spill over the
 * controls and the action buttons stay visible on any screen.
 */
const DESIGN_WIDTH = 430
const DESIGN_SEATS = 54
const DESIGN_FELT = 252
const DESIGN_HAND = 104
const DESIGN_LEGEND = 20
const DESIGN_GAP = 10
const DESIGN_HEIGHT =
  DESIGN_SEATS +
  DESIGN_GAP +
  DESIGN_FELT +
  DESIGN_GAP +
  DESIGN_HAND +
  DESIGN_GAP +
  DESIGN_LEGEND

/** A card in the hand: full width, and how much of it stays visible. */
const HAND_CARD_WIDTH = 62
const HAND_STEP_MAX = HAND_CARD_WIDTH + 3
/** A card on the felt is a touch wider — it is the one everyone reads. */
const PILE_CARD_WIDTH = 76

/** How far apart the hand's cards sit: they only overlap once the row would
 * run past the room's width, so a small hand reads like a real fan and a
 * twenty-card hand still fits without a scrollbar. */
function handStep(count: number): number {
  if (count <= 1) return HAND_STEP_MAX
  const available = DESIGN_WIDTH - 12
  return Math.min(HAND_STEP_MAX, (available - HAND_CARD_WIDTH) / (count - 1))
}

/** The pending-UNO window, counted down the same way the turn timer is. */
function secondsUntil(
  deadline: number | null,
  serverNow: number,
  fetchedAt: number,
  now: number,
): number | null {
  if (deadline == null) return null
  return Math.max(0, Math.ceil((deadline - serverNow - (now - fetchedAt)) / 1000))
}

export function UnoRoomPage() {
  const { slug = 'uno', tableId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [table, setTable] = useState<TableDetails | null>(null)
  /** When the latest table snapshot arrived (for the turn timer). */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  /** The wild card waiting for a colour choice. */
  const [wildCard, setWildCard] = useState<string | null>(null)
  /** A WF4 challenge waiting for the victim's decision. */
  const [challengeWf4, setChallengeWf4] = useState<{ offenderUserId: number; victimUserId: number } | null>(null)
  const [feltZoom, setFeltZoom] = useState(1)
  const areaRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)
  const shownResultRef = useRef('init')
  /** Bumped whenever a new card lands on the discard pile, to flip it in. */
  const [discardSeq, setDiscardSeq] = useState(0)
  /** The pile top the sequence above was counted for. */
  const [prevDiscard, setPrevDiscard] = useState<string | null>(null)

  const game = table?.game.kind === 'uno' ? table.game : null
  const seats = table?.seats ?? []
  const mySeat = seats.find((seat) => seat.userId === user?.id)
  const phase = game?.phase ?? 'waiting'
  const isPlaying = phase === 'playing'
  const isFinished = phase === 'finished'
  const legal = game?.legal ?? null
  const hand = game?.hand ?? []
  const isMyTurn = isPlaying && game?.turnUserId === user?.id
  const playable = new Set(legal?.playable ?? [])
  const discardTop = game?.discardTop ?? null
  const activeColor = game?.activeColor ?? 'R'

  // A new card on the pile — even the same code played twice — flips in.
  // Adjusting state during render is React's own pattern for this: the
  // component re-renders straight away, before anything reaches the screen.
  if (prevDiscard !== discardTop) {
    setPrevDiscard(discardTop)
    setDiscardSeq(discardSeq + 1)
  }

  // Scale the whole room down to fit: seats, felt and hand shrink together.
  useLayoutEffect(() => {
    const area = areaRef.current
    if (!area) return
    const measure = () => {
      const width = area.clientWidth - 24
      const height = area.clientHeight - 24
      setFeltZoom(
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
      // (`/play/uno/table/<poker id>`). Follow the table's own game instead
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

  // Entering an Uno table takes a seat (joining twice just keeps yours).
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

  // Poll for updates: other players' moves, timeouts, etc.
  useEffect(() => {
    if (!table) return
    let cancelled = false
    const poll = async () => {
      if (cancelled) return
      requestSeqRef.current += 1
      const seq = requestSeqRef.current
      try {
        const details = await tablesApi.get(tableId)
        if (!cancelled && seq === requestSeqRef.current) applyTable(details)
      } catch {
        // Ignore transient errors; the next poll will retry.
      }
    }
    const interval = window.setInterval(poll, POLL_INTERVAL_MS)
    poll()
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [tableId, applyTable])

  const handleLeave = useCallback(async () => {
    try {
      await tablesApi.leave(tableId)
    } catch {
      // Table may already be gone — still navigate back.
    }
    navigate(`/play/${slug}`, { replace: true })
  }, [tableId, navigate, slug])

  /** Tapping a card plays it; a wild asks for its colour first. */
  function handleCardClick(card: string) {
    if (!playable.has(card) || pending) return
    if (card.startsWith('W')) {
      setWildCard(card)
      return
    }
    void sendAction({ type: 'play', card })
  }

  function chooseColor(color: UnoColor) {
    const card = wildCard
    setWildCard(null)
    if (card != null) void sendAction({ type: 'play', card, color })
  }

  const winnerName = seats.find(
    (seat) => seat.userId === game?.winnerUserId,
  )?.displayName
  const turnName = seats.find((seat) => seat.userId === game?.turnUserId)
    ?.displayName
  const pendingUnoName = seats.find(
    (seat) => seat.userId === game?.pendingUno?.userId,
  )?.displayName
  const catchName = seats.find(
    (seat) => seat.userId === legal?.catchUserId,
  )?.displayName
  const offenderName = seats.find(
    (seat) => seat.userId === legal?.challengeWf4?.offenderUserId,
  )?.displayName

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
    toast.success(
      winnerName
        ? `${winnerName} won — ${game.winnerPoints} points`
        : 'Game over',
    )
  }, [game, table?.id, winnerName])

  // A gentle nudge when it is your turn.
  useEffect(() => {
    if (isMyTurn) {
      toast.info('Your turn', { id: 'uno-your-turn-toast' })
    } else {
      toast.dismiss('uno-your-turn-toast')
    }
  }, [isMyTurn])

  // Sync challenge WF4 state from server
  useEffect(() => {
    if (legal?.challengeWf4) {
      setChallengeWf4(legal.challengeWf4)
    } else {
      setChallengeWf4(null)
    }
  }, [legal?.challengeWf4])

  const secondsLeft = secondsUntil(
    game?.turnDeadline ?? null,
    game?.serverNow ?? 0,
    fetchedAt,
    now,
  )
  const showTimer = isPlaying && secondsLeft != null

  let statusText = ''
  if (table) {
    if (isPlaying) {
      if (isMyTurn) {
        statusText =
          legal?.drawnCard != null
            ? 'You drew — play it or pass'
            : playable.size > 0
            ? 'Your turn — play a card'
            : 'Your turn — draw a card'
      } else if (turnName) {
        statusText = `Waiting for ${turnName}…`
      }
    } else if (isFinished) {
      statusText = winnerName
        ? `${winnerName} won with ${game?.winnerPoints ?? 0} points — ready up for a rematch.`
        : 'The game is over — ready up for the next one.'
    } else if (seats.length < 2) {
      statusText = 'Waiting for one more player to take a seat.'
    } else if (mySeat?.ready) {
      statusText = 'You are ready — waiting for the others.'
    } else {
      statusText = 'Everyone seated — tap Ready to deal.'
    }
  }

  const playerBySeat = new Map(
    (game?.players ?? []).map((player) => [player.seatIndex, player]),
  )

  const seatCards = Array.from({ length: table?.maxSeats ?? 6 }, (_, index) => {
    const seat = seats.find((s) => s.seatIndex === index)
    if (!seat) return <UnoSeat key={index} />
    const player = playerBySeat.get(index)
    const seatPlayer: UnoSeatPlayer = {
      name: seat.displayName,
      ready: seat.ready,
      status: seat.status,
      isTurn: game?.turnUserId === seat.userId,
      isYou: seat.userId === user?.id,
      cardCount: player?.cardCount ?? 0,
      inGame: player != null,
      winner: game?.winnerUserId === seat.userId,
      saidUno: player?.saidUno ?? false,
      pendingUno: player?.pendingUno ?? false,
    }
    return <UnoSeat key={index} player={seatPlayer} />
  })

  const canReady =
    mySeat != null && !mySeat.ready && seats.length >= 2 && !isPlaying

  const handEntries = keyedHand(hand)
  const step = handStep(handEntries.length)
  const handWidth =
    handEntries.length === 0
      ? 0
      : HAND_CARD_WIDTH + step * (handEntries.length - 1)
  const handStart = (DESIGN_WIDTH - handWidth) / 2

  const players = game?.players ?? []
  // The line under the piles narrates the last move: normally the player just
  // before whoever is on the clock (a skip or a draw two also lands there).
  const previousPlayer = (() => {
    if (!isPlaying || game?.turnUserId == null || players.length === 0) {
      return null
    }
    const index = players.findIndex((p) => p.userId === game.turnUserId)
    if (index < 0) return null
    const n = players.length
    const dir = game.direction
    return players[(((index - dir) % n) + n) % n] ?? null
  })()
  const lastAction =
    previousPlayer?.lastAction ??
    [...players].reverse().find((player) => player.lastAction != null)
      ?.lastAction ??
    null

  const pileHeight = (PILE_CARD_WIDTH * 7) / 5

  const sendAction = useCallback(
    (action: { type: TableActionType; card?: string; color?: UnoColor; accept?: boolean }) => {
      setPending(true)
      tablesApi
        .act(tableId, action)
        .then((details) => applyTable(details))
        .catch((error) => {
          toast.error(getApiErrorMessage(error, 'That move did not work.'))
        })
        .finally(() => setPending(false))
    },
    [tableId, applyTable],
  )

  return (
    <div className="grid h-[100dvh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background room-side:grid-cols-[minmax(0,1fr)_minmax(240px,46%)] room-side:grid-rows-[auto_minmax(0,1fr)]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2.5 room-side:col-span-2">
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
                    ? `${table.seats.length} · ${table.maxSeats} seated · Uno`
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

      {/* Felt area — absorbs the leftover height, the room scales to fit */}
      <div
        ref={areaRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 room-side:col-start-1 room-side:row-start-2"
      >
        {table === null ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <>
            <div
              className="flex flex-col items-center"
              style={{ zoom: feltZoom, gap: DESIGN_GAP, width: DESIGN_WIDTH }}
            >
              <div
                data-testid="uno-seats"
                className="grid w-full gap-1.5"
                style={{
                  gridTemplateColumns: `repeat(${table.maxSeats}, minmax(0, 1fr))`,
                  height: DESIGN_SEATS,
                }}
              >
                {seatCards}
              </div>

              <div
                data-testid="uno-felt"
                className="relative flex shrink-0 flex-col overflow-hidden rounded-2xl border border-white/10"
                style={{
                  width: DESIGN_WIDTH,
                  height: DESIGN_FELT,
                  background:
                    'radial-gradient(120% 95% at 50% 38%, #1c3b2d, #0c1712 74%)',
                }}
              >
                <div className="flex items-center justify-between px-3 pt-2.5">
                  <Badge
                    variant="outline"
                    data-testid="uno-direction"
                    className="gap-1 border-white/20 bg-black/30"
                  >
                    <RepeatIcon
                      className={cn(
                        'size-3',
                        game?.direction === -1 && 'scale-x-[-1]',
                      )}
                    />
                    {game?.direction === -1 ? 'Anti-clockwise' : 'Clockwise'}
                  </Badge>
                  <Badge
                    variant="outline"
                    data-testid="uno-draw-count"
                    className="border-white/20 bg-black/30"
                  >
                    Draw pile {game?.drawCount ?? 0}
                  </Badge>
                </div>

                <div
                  className="flex flex-1 items-center justify-center gap-7"
                  data-testid="uno-piles"
                >
                  {/* The pile you draw from. */}
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="relative" style={{ width: PILE_CARD_WIDTH }}>
                      <span
                        aria-hidden
                        className="absolute inset-0 translate-x-1 translate-y-1 rounded-[12%] bg-black/40"
                      />
                      <UnoCardBack className="relative w-full" />
                    </div>
                    <span className="text-[10px] tracking-[0.16em] text-white/55 uppercase">
                      Draw
                    </span>
                  </div>

                  {/* The discard pile, ringed in the colour to match. */}
                  <div className="flex flex-col items-center gap-1.5">
                    <div
                      className="relative"
                      style={{ width: PILE_CARD_WIDTH, height: pileHeight }}
                    >
                      {/* Two face-down ghosts give the pile its depth. */}
                      <span
                        aria-hidden
                        className="absolute inset-0 rotate-[7deg] rounded-[12%] border border-black/50 bg-[linear-gradient(150deg,#b91c1c,#7f1d1d)] shadow-md"
                      />
                      <span
                        aria-hidden
                        className="absolute inset-0 -rotate-[6deg] rounded-[12%] border border-black/50 bg-[linear-gradient(150deg,#b91c1c,#7f1d1d)] shadow-md"
                      />
                      {/* The colour the table must match, glowing behind the top card. */}
                      {isPlaying && (
                        <motion.span
                          aria-hidden
                          className="absolute -inset-1.5 rounded-[16%]"
                          style={{
                            boxShadow: `0 0 22px ${UNO_COLOR_HEX[activeColor]}`,
                            border: `2px solid ${UNO_COLOR_HEX[activeColor]}`,
                          }}
                          animate={{ opacity: [0.35, 0.85, 0.35] }}
                          transition={{ duration: 2.2, repeat: Infinity }}
                        />
                      )}
                      <AnimatePresence initial={false}>
                        {discardTop != null && (
                          <motion.div
                            key={discardSeq}
                            className="absolute inset-0"
                            style={{ transformPerspective: 900 }}
                            initial={{ rotateY: -95, y: -16, opacity: 0 }}
                            animate={{ rotateY: 0, y: 0, opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{
                              type: 'spring',
                              stiffness: 300,
                              damping: 26,
                            }}
                          >
                            <UnoCardFace card={discardTop} className="w-full" />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {isPlaying ? (
                      <span
                        data-testid="uno-active-color"
                        className="text-[10px] font-semibold tracking-[0.16em] uppercase"
                        style={{ color: UNO_COLOR_HEX[activeColor] }}
                      >
                        {UNO_COLOR_NAMES[activeColor]}
                      </span>
                    ) : (
                      <span className="text-[10px] tracking-[0.16em] text-white/55 uppercase">
                        Discard
                      </span>
                    )}
                  </div>
                </div>

                {/* The UNO window, or the last thing that happened. */}
                <div className="flex h-8 shrink-0 items-center justify-center px-3 pb-2.5">
                  {game?.pendingUno != null ? (
                    <span
                      data-testid="uno-pending"
                      className="flex items-center gap-1.5 rounded-full border border-red-400/60 bg-red-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-red-200"
                    >
                      {game.pendingUno.userId === user?.id
                        ? 'Call UNO!'
                        : `${pendingUnoName ?? 'A player'} is on one card — catch them!`}
                    </span>
                  ) : lastAction ? (
                    <span
                      data-testid="uno-last-action"
                      className="truncate text-[11px] text-white/50"
                    >
                      {lastAction}
                    </span>
                  ) : null}
                </div>
              </div>

              <div
                data-testid="uno-hand"
                className="relative"
                style={{ width: DESIGN_WIDTH, height: DESIGN_HAND }}
              >
                {handEntries.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <p className="text-xs text-muted-foreground">
                      {isPlaying
                        ? 'Your hand is empty.'
                        : 'Your cards appear here.'}
                    </p>
                  </div>
                ) : (
                  handEntries.map(({ card, key }, index) => {
                    const canPlay = playable.has(card)
                    return (
                      <motion.div
                        key={key}
                        className="absolute bottom-1"
                        style={{
                          left: handStart + index * step,
                          width: HAND_CARD_WIDTH,
                          zIndex: index,
                        }}
                        initial={{ y: 16, opacity: 0 }}
                        animate={{ y: canPlay ? -10 : 0, opacity: 1 }}
                        transition={{
                          type: 'spring',
                          stiffness: 420,
                          damping: 32,
                        }}
                      >
                        <Button
                          type="button"
                          variant="ghost"
                          data-testid="uno-hand-card"
                          data-card={card}
                          data-playable={canPlay}
                          // Not `disabled`: the button's disabled style dims the
                          // card to 50% and stacks with the unplayable fade, so
                          // the hand reads as blank. `handleCardClick` is the
                          // guard, and aria-disabled keeps it announced.
                          aria-disabled={!canPlay || pending}
                          onClick={() => handleCardClick(card)}
                          className={cn(
                            // The button is the card's box: it must fill the
                            // 62px slot, or the card's `w-full` has nothing to
                            // resolve against and collapses to nothing.
                            'h-auto w-full rounded-[12%] p-0 hover:bg-transparent',
                            'focus-visible:ring-2 focus-visible:ring-ring',
                            canPlay
                              ? 'shadow-[0_0_16px_rgba(251,191,36,0.4)] ring-2 ring-amber-400/90'
                              : 'opacity-80',
                          )}
                        >
                          <UnoCardFace card={card} className="w-full" />
                        </Button>
                      </motion.div>
                    )
                  })
                )}
              </div>

              <p
                data-testid="uno-legend"
                className="text-center text-[11px] leading-[1.4] text-muted-foreground"
              >
                Match the colour or the number · wilds pick a colour · down to one
                card? call UNO · wild draw 4 can be challenged
              </p>
            </div>
          </>
        )}
      </div>

      {/* Controls — under the felt in portrait, beside it when the screen is
          wide but short, so the felt can use the full height */}
      <div className="shrink-0 border-t bg-card px-4 pt-3 pb-5 room-side:col-start-2 room-side:row-start-2 room-side:flex room-side:items-center room-side:border-t-0 room-side:border-l room-side:py-3">
        <div
          className="mx-auto flex w-full max-w-[440px] flex-col gap-2.5"
          data-testid="controls"
        >
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

          {isPlaying ? (
            <>
              {isMyTurn ? (
                <div className="grid grid-cols-2 gap-2 room-side:grid-cols-1">
                  <div className="flex items-center rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {legal?.drawnCard != null
                      ? 'Play the card you drew, or pass'
                      : playable.size > 0
                      ? 'Tap a highlighted card, or draw'
                      : 'Nothing matches — draw a card'}
                  </div>
                  {legal?.draw ? (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      data-testid="draw"
                      onClick={() => void sendAction({ type: 'draw' })}
                    >
                      Draw a card
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={pending}
                      data-testid="pass"
                      onClick={() => void sendAction({ type: 'pass' })}
                    >
                      Pass
                    </Button>
                  )}
                </div>
              ) : (
                <Button className="w-full" variant="outline" disabled>
                  Waiting for {turnName ?? 'the other player'}…
                </Button>
              )}

              {legal?.callUno ? (
                <Button
                  className="w-full"
                  size="lg"
                  disabled={pending}
                  data-testid="call-uno"
                  onClick={() => void sendAction({ type: 'call_uno' })}
                >
                  Call UNO!
                </Button>
              ) : legal?.catchUserId != null ? (
                <Button
                  className="w-full"
                  size="lg"
                  variant="destructive"
                  disabled={pending}
                  data-testid="catch-uno"
                  onClick={() => void sendAction({ type: 'catch_uno' })}
                >
                  Catch {catchName ?? 'them'} — missed UNO
                </Button>
              ) : legal?.challengeWf4 ? (
                <Button
                  className="w-full"
                  size="lg"
                  variant="destructive"
                  disabled={pending}
                  data-testid="challenge-wf4"
                  onClick={() => void sendAction({ type: 'challenge_wf4', accept: false })}
                >
                  Challenge WF4
                </Button>
              ) : null}
            </>
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

      {/* Wild colour picker */}
      <Dialog
        open={wildCard != null}
        onOpenChange={(open) => {
          if (!open) setWildCard(null)
        }}
      >
        <DialogContent className="max-w-[320px]">
          <DialogHeader>
            <DialogTitle>Pick a colour</DialogTitle>
            <DialogDescription>
              {wildCard === 'WF'
                ? 'Your wild draw four takes the colour below.'
                : 'The table must match the colour you choose.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {UNO_COLORS.map((color) => (
              <Button
                key={color}
                variant="outline"
                className="h-14 justify-start gap-2.5"
                data-testid={`wild-${color}`}
                disabled={pending}
                onClick={() => chooseColor(color)}
              >
                <span
                  className="size-6 rounded-full border border-black/40 shadow-inner"
                  style={{ backgroundColor: UNO_COLOR_HEX[color] }}
                />
                {UNO_COLOR_NAMES[color]}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* WF4 Challenge dialog */}
      <Dialog
        open={challengeWf4 != null}
        onOpenChange={(open) => {
          if (!open) setChallengeWf4(null)
        }}
      >
        <DialogContent className="max-w-[320px]">
          <DialogHeader>
            <DialogTitle>Wild Draw Four challenged!</DialogTitle>
            <DialogDescription>
              {challengeWf4?.offenderUserId === user?.id
                ? 'The next player challenged your Wild Draw Four. They must accept (draw 4) or challenge (if you had no matching colour).'
                : `${offenderName ?? 'A player'} played a Wild Draw Four. Do you accept (draw 4) or challenge? If they had no card of the active colour, they draw 4 instead. If they did, you draw 6.`}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="destructive"
              className="h-14 justify-start gap-2.5"
              disabled={pending}
              onClick={() => void sendAction({ type: 'challenge_wf4', accept: false })}
            >
              Challenge
            </Button>
            <Button
              variant="secondary"
              className="h-14 justify-start gap-2.5"
              disabled={pending}
              onClick={() => void sendAction({ type: 'challenge_wf4', accept: true })}
            >
              Accept (draw 4)
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}