import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  UserPlusIcon,
} from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { InviteFriendsDialog } from '@/components/invite-friends-dialog'
import { RoomWaitingActions } from '@/components/room-waiting-actions'
import { RoomConnectionStatus } from '@/components/room-connection-status'
import { PlayerWalletBadge } from '@/components/player-wallet-badge'
import { CardBack, PlayingCard } from '@/components/playing-card'
import { PokerSeat } from '@/components/poker-seat'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Slider } from '@/components/ui/slider'
import {
  getApiErrorMessage,
  getApiStatus,
  tablesApi,
  type TableActionType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatBlinds, formatMoney } from '@/lib/format'
import type { TableDetails, TablePotAward, TableSeat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLiveTable } from '@/lib/use-live-table'

const SEAT_WIDTH_PERCENT = 25.2

/**
 * Design size of the table (matches the wireframe). The table renders at
 * this size and is scaled as a whole to fit the screen, so every part of
 * it — seats, cards, badges — stays visible and in proportion.
 */
const TABLE_WIDTH = 412
const TABLE_HEIGHT = 690

/** Plate size in design pixels. */
const PLATE_WIDTH = (SEAT_WIDTH_PERCENT / 100) * TABLE_WIDTH
const PLATE_HEIGHT = (PLATE_WIDTH * 140) / 104

/** Converts design pixels to percentages of the table (x uses its width). */
const percentX = (px: number) => (px / TABLE_WIDTH) * 100
const percentY = (px: number) => (px / TABLE_HEIGHT) * 100

/**
 * Seats ring the table on evenly spaced plates: two neighbours are always
 * the same distance apart, whichever way they are separated. The vertical
 * gap between stacked plates equals the horizontal gap between plates side
 * by side, and plates that sit diagonally keep the same clearance. The gap
 * is as wide as three plate columns plus a small margin allow.
 */
const RING_MARGIN = 4
const SEAT_GAP = (TABLE_WIDTH - 2 * RING_MARGIN - 3 * PLATE_WIDTH) / 2
/** Column offset of the outer seats, measured from the table's centre. */
const OUTER_COL = PLATE_WIDTH + SEAT_GAP

/**
 * Where every seat sits: how many columns it is from the middle of the
 * table (0 = middle, ±1 = outer, ±0.5 = half a column in, which the pair
 * of seats closing an odd ring uses) and which row it is on. Index 0 is the
 * top-centre seat and the rest run clockwise, so neighbouring indices are
 * always neighbouring plates.
 */
const RING_SEATS: Record<number, ReadonlyArray<readonly [number, number]>> = {
  2: [
    [0, 0],
    [0, 1],
  ],
  3: [
    [0, 0],
    [1, 1],
    [-1, 1],
  ],
  4: [
    [0, 0],
    [1, 1],
    [0, 2],
    [-1, 1],
  ],
  5: [
    [0, 0],
    [1, 1],
    [0.5, 2],
    [-0.5, 2],
    [-1, 1],
  ],
  6: [
    [0, 0],
    [1, 1],
    [1, 2],
    [0, 3],
    [-1, 2],
    [-1, 1],
  ],
  7: [
    [0, 0],
    [1, 1],
    [1, 2],
    [0.5, 3],
    [-0.5, 3],
    [-1, 2],
    [-1, 1],
  ],
  8: [
    [0, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [0, 4],
    [-1, 3],
    [-1, 2],
    [-1, 1],
  ],
}

type RingStep = 'stack' | 'stagger' | 'pair' | 'spread'

/**
 * How each row of a ring relates to the row above it:
 *  - 'stack'   the rows share columns, so they stand exactly SEAT_GAP
 *              apart vertically;
 *  - 'stagger' the rows overlap horizontally or cross diagonally, so the
 *              height left over is spent here — never more than a full
 *              diagonal, which keeps their clearance at SEAT_GAP too;
 *  - 'pair'    three-handed: the bottom pair sits in the outer columns, so
 *              the top seat drops as far as that pair's own (wider) gap,
 *              keeping the three clearances equal;
 *  - 'spread'  two seats only: they take the full height, top and bottom.
 */
const RING_STEPS: Record<number, ReadonlyArray<RingStep>> = {
  2: ['spread'],
  3: ['pair'],
  4: ['stagger', 'stagger'],
  5: ['stagger', 'stack'],
  6: ['stagger', 'stack', 'stagger'],
  7: ['stagger', 'stack', 'stack'],
  8: ['stagger', 'stack', 'stack', 'stagger'],
}

/** Top offset of every row in a ring of `count` seats, in design pixels. */
function ringRowTops(count: number): number[] {
  const steps = RING_STEPS[count] ?? []
  const free = TABLE_HEIGHT - PLATE_HEIGHT
  const stack = PLATE_HEIGHT + SEAT_GAP
  const staggers = steps.filter((step) => step === 'stagger').length
  const stacked = steps.filter((step) => step === 'stack').length
  let stagger = 0
  if (staggers > 0) {
    const budget = (free - stacked * stack) / staggers
    // A ring that also stacks rows needs a flush diagonal, so every
    // clearance matches; a ring of diagonals only can open them wider.
    const cap = stacked > 0 ? PLATE_HEIGHT : stack
    stagger =
      budget >= cap
        ? cap
        : budget >= PLATE_HEIGHT
          ? PLATE_HEIGHT
          : Math.max(budget, 0)
  }
  const tops = [0]
  for (const step of steps) {
    const top = tops[tops.length - 1] ?? 0
    if (step === 'pair') {
      // The pair is as wide as the table allows; the seat above it stands
      // that same distance away, measured across the diagonal.
      const gap = 2 * OUTER_COL - PLATE_WIDTH
      const drop = Math.sqrt(Math.max(gap * gap - SEAT_GAP * SEAT_GAP, 0))
      tops.push(top + PLATE_HEIGHT + drop)
    } else {
      tops.push(
        step === 'spread' ? free : top + (step === 'stack' ? stack : stagger),
      )
    }
  }
  return tops
}

/** Top of the pot badge, as a height fraction (it is drawn at 35.5%). */
const POT_TOP = 0.355 * TABLE_HEIGHT

/** Top-left corner of a seat's plate, in design pixels. */
function seatCorner(index: number, count: number): { x: number; y: number } {
  const seats = RING_SEATS[count] ?? RING_SEATS[8] ?? []
  const [column = 0, row = 0] = seats[Math.min(index, seats.length - 1)] ?? []
  const tops = ringRowTops(seats.length)
  const ringHeight = (tops[tops.length - 1] ?? 0) + PLATE_HEIGHT
  // Centre the ring, but nudge a short ring up so its top seat never
  // covers the pot badge.
  const top = Math.max(
    RING_MARGIN,
    Math.min((TABLE_HEIGHT - ringHeight) / 2, POT_TOP - 4 - PLATE_HEIGHT),
  )
  return {
    x: TABLE_WIDTH / 2 + column * OUTER_COL - PLATE_WIDTH / 2,
    y: top + (tops[row] ?? 0),
  }
}

/** Positions a seat's plate in the ring. */
function seatPosition(index: number, count: number): CSSProperties {
  const corner = seatCorner(index, count)
  return {
    left: `${percentX(corner.x).toFixed(2)}%`,
    top: `${percentY(corner.y).toFixed(2)}%`,
  }
}

/** Horizontal centre of a seat, as a percentage of the table width. */
function seatCenterPercent(index: number, count: number): number {
  return percentX(seatCorner(index, count).x + PLATE_WIDTH / 2)
}

/** Vertical position of a seat's top edge, as a percentage. */
function seatTopPercent(index: number, count: number): number {
  return percentY(seatCorner(index, count).y)
}

/** Chip sizes and placement on a seat's plate (design pixels). */
const CHIP_DIAMETER = 24
/** Chips sit this far left/right of the seat centre, below the seat's top. */
const CHIP_OFFSET_X = 13
/** ...and vertically here: level with the plate's bottom edge. */
const CHIP_OFFSET_Y = 20

/**
 * Pins the dealer and blind chips to the bottom corners of a seat — one rule
 * for every seat, clear of the seat's own content and of the bet badge that
 * hangs under the plate. The dealer sits on the bottom-left corner, the
 * blinds on the bottom-right, so a heads-up button (which also posts the
 * small blind) can show both at once.
 *
 * In a ring the seats of a row sit one gap apart, where a corner chip would
 * land on the neighbouring plate. There the chip slides back over its own
 * plate just far enough to clear it; only plates sharing a row can collide,
 * so every other seat keeps the plain corner placement.
 */
function seatCornerPosition(
  index: number,
  count: number,
  side: 'left' | 'right',
): CSSProperties {
  const centre = seatCenterPercent(index, count)
  const top = seatTopPercent(index, count) + CHIP_OFFSET_Y
  const halfChipX = percentX(CHIP_DIAMETER / 2)
  const halfChipY = percentY(CHIP_DIAMETER / 2)
  const plateHeight = percentY(PLATE_HEIGHT)
  let left = centre + (side === 'left' ? -CHIP_OFFSET_X : CHIP_OFFSET_X)

  for (let other = 0; other < count; other += 1) {
    if (other === index) continue
    const otherCentre = seatCenterPercent(other, count)
    // Only a plate on the same side as the chip can get in its way.
    if (side === 'left' ? otherCentre > centre : otherCentre < centre) continue
    const otherTop = seatTopPercent(other, count)
    const sharesRow =
      otherTop < top + halfChipY && otherTop + plateHeight > top - halfChipY
    if (!sharesRow) continue
    // Centre-to-centre spacing that leaves this chip clear of that plate.
    const clear = SEAT_WIDTH_PERCENT / 2 + halfChipX + percentX(2)
    left =
      side === 'left'
        ? Math.max(left, otherCentre + clear)
        : Math.min(left, otherCentre - clear)
  }

  left = Math.min(Math.max(left, 3), 97)
  return {
    left: `${left.toFixed(2)}%`,
    top: `${top.toFixed(2)}%`,
  }
}

export function TableRoomPage() {
  const { slug = '', tableId = '' } = useParams()
  const navigate = useNavigate()
  const { user, refreshUser } = useAuth()
  const [table, setTable] = useState<TableDetails | null>(null)
  /** When the latest table snapshot arrived (for the turn timer). */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [bet, setBet] = useState(0)
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const [tableZoom, setTableZoom] = useState(1)
  const requestSeqRef = useRef(0)
  const shownResultRef = useRef('init')

  // Scale the whole table down to fit the table area. Because the table
  // is laid out at its design size and scaled as one unit, its content
  // can never spill over the betting controls below — the action buttons
  // stay visible on any screen size.
  useLayoutEffect(() => {
    const area = tableAreaRef.current
    if (!area) return
    const measure = () => {
      // clientWidth/Height include the 12px padding on each side.
      const width = area.clientWidth - 24
      const height = area.clientHeight - 24
      setTableZoom(Math.min(width / TABLE_WIDTH, height / TABLE_HEIGHT, 1))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area)
    return () => observer.disconnect()
  }, [])

  const backToLobby = useCallback(
    () => navigate(`/play/${slug}`, { replace: true }),
    [navigate, slug],
  )

  const applyTable = useCallback(
    (details: TableDetails) => {
      // A shared link can name the wrong game for this table
      // (`/play/poker/table/<ludo id>`). Follow the table's own game instead
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

  // Entering the table takes a seat (joining twice just keeps yours).
  useEffect(() => {
    if (slug !== 'poker') return
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
  }, [slug, tableId, backToLobby, applyTable])

  // Fetch a masked snapshot after live invalidation or a deadline wakeup.
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


  // Local clock for a smooth countdown between server snapshots.
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(interval)
  }, [])

  const sendAction = useCallback(
    async (action: { type: TableActionType; amount?: number }) => {
      const seq = ++requestSeqRef.current
      setPending(true)
      try {
        const details = await tablesApi.act(tableId, action)
        if (seq === requestSeqRef.current) applyTable(details)
      } catch (error) {
        toast.error(getApiErrorMessage(error, 'That action did not work.'))
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
      void refreshUser().catch(() => {})
    } catch {
      // Table may already be gone — still navigate back.
    }
    navigate(`/play/${slug}`, { replace: true })
  }

  const game = table?.game.kind === 'poker' ? table.game : null
  useLiveTable(tableId, refresh, game?.turnDeadline ?? null, game?.serverNow ?? null, fetchedAt)
  const seats = table?.seats ?? []
  const mySeat = seats.find((seat) => seat.userId === user?.id)
  const legal = game?.legal ?? null
  const isMyTurn = game != null && game.turnUserId === user?.id && legal != null
  const isWaiting = (game?.phase ?? 'waiting') === 'waiting'
  const raiseRange = legal?.raise ?? null
  const raiseTarget = raiseRange
    ? Math.min(Math.max(bet, raiseRange.min), raiseRange.max)
    : 0

  // The main pot and any side pots an all-in cut off. Only the players who
  // stayed in can win a side pot.
  const pots = game?.pots ?? []
  const mainPot = pots.find((pot) => pot.main)?.amount ?? game?.pot ?? 0
  const sidePots = pots.filter((pot) => !pot.main)

  // How the last hand was split: "Ada won the main pot $900 (Pair)".
  const potResultText = useCallback(
    (awards: TablePotAward[] | null, seatList: TableSeat[]): string => {
      if (!awards?.length) return ''
      const nameOf = (userId: number) =>
        seatList.find((seat) => seat.userId === userId)?.displayName ??
        'Player'
      return awards
        .map((award) => {
          const names = award.winners.map((winner) => nameOf(winner.userId))
          const hand = award.winners[0]?.hand
          const label = award.main ? 'main pot' : 'side pot'
          if (names.length > 1) {
            return `${names.join(' & ')} split the ${label} ${formatMoney(
              award.amount,
            )}${hand ? ` (${hand})` : ''}`
          }
          return `${names[0]} won the ${label} ${formatMoney(award.amount)}${
            hand ? ` (${hand})` : ''
          }`
        })
        .join(' · ')
    },
    [],
  )

  // Announce the end of a hand (never for history on first load).
  useEffect(() => {
    const poker = table?.game.kind === 'poker' ? table.game : null
    const winners = poker?.winners
    if (!table || !poker || !winners?.length || poker.handNumber === 0) return
    const key = `t${table.id}:h${poker.handNumber}`
    if (shownResultRef.current === 'init') {
      shownResultRef.current = key
      return
    }
    if (shownResultRef.current === key) return
    shownResultRef.current = key
    const breakdown = potResultText(poker.potAwards, table.seats)
    if (breakdown) {
      toast.success(breakdown)
      return
    }
    const total = winners.reduce((sum, winner) => sum + winner.amount, 0)
    const names = winners
      .map(
        (winner) =>
          table.seats.find((seat) => seat.userId === winner.userId)
            ?.displayName ?? 'Player',
      )
      .join(' & ')
    const hand = winners[0]?.hand
    toast.success(
      `${names} won ${formatMoney(total)}${hand ? ` — ${hand}` : ''}`,
    )
  }, [table, potResultText])

  // A gentle nudge when it is your turn.
  useEffect(() => {
    if (isMyTurn) {
      toast.info('Your turn', { id: 'your-turn-toast' })
    } else {
      toast.dismiss('your-turn-toast')
    }
  }, [isMyTurn])

  if (slug !== 'poker') {
    return <Navigate to={`/play/${slug}`} replace />
  }

  const blindsLabel = table
    ? formatBlinds(table.smallBlind, table.bigBlind)
    : null

  const secondsLeft =
    game?.turnDeadline != null
      ? Math.max(
          0,
          Math.ceil(
            (game.turnDeadline - game.serverNow - (now - fetchedAt)) / 1000,
          ),
        )
      : null
  const showTimer = !isWaiting && secondsLeft != null

  const canCheck = legal?.check ?? false
  const callAmount = legal?.callAmount ?? null
  const callDisabled = !isMyTurn || pending || (!canCheck && callAmount == null)
  const raiseDisabled = !isMyTurn || pending || raiseRange == null
  const allInDisabled = !isMyTurn || pending || !legal?.allIn

  function onCall() {
    if (canCheck) {
      void sendAction({ type: 'check' })
    } else if (callAmount != null) {
      void sendAction({ type: 'call' })
    }
  }

  const turnPlayerName = seats.find(
    (seat) => seat.userId === game?.turnUserId,
  )?.displayName

  let statusText = ''
  if (table) {
    const winners = game?.winners
    if (isWaiting && winners?.length) {
      const breakdown = potResultText(game?.potAwards ?? null, seats)
      if (breakdown) {
        statusText = breakdown
      } else {
        const total = winners.reduce((sum, winner) => sum + winner.amount, 0)
        const names = winners
          .map(
            (winner) =>
              seats.find((seat) => seat.userId === winner.userId)
                ?.displayName ?? 'Player',
          )
          .join(' & ')
        const hand = winners[0]?.hand
        statusText = `${names} won ${formatMoney(total)}${hand ? ` · ${hand}` : ''}`
      }
    } else if (isWaiting) {
      if (seats.length < 2) {
        statusText = 'Waiting for one more player to take a seat.'
      } else if (mySeat?.ready) {
        statusText = 'You are ready — waiting for the others.'
      } else {
        statusText = 'Everyone seated — tap Ready to deal the next hand.'
      }
    } else if (isMyTurn) {
      statusText = legal?.callAllIn
        ? 'Your turn — calling puts you all-in.'
        : 'Your turn.'
    } else if (turnPlayerName) {
      statusText = `Waiting for ${turnPlayerName}…`
    }
  }

  const community = game?.community ?? []
  const flop = community.slice(0, 3)
  const turnRiver = community.slice(3, 5)

  return (
    <div data-game="poker" className="grid h-[100dvh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background room-side:grid-cols-[minmax(0,1fr)_minmax(240px,46%)] room-side:grid-rows-[auto_minmax(0,1fr)]">
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
              showTimer &&
                secondsLeft != null &&
                secondsLeft <= 10 &&
                'text-red-400',
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
                    ? `${table.seats.length} · ${table.maxSeats} seated${
                        blindsLabel ? ` · blinds ${blindsLabel}` : ''
                      }`
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

      {/* Table area — absorbs the leftover height, the table scales to fit */}
      <div
        ref={tableAreaRef}
        className="room-board-area flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 room-side:col-start-1 room-side:row-start-2"
      >
        {table === null ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <div
            className="relative h-[690px] w-[412px]"
            style={{ zoom: tableZoom }}
          >
            {/* Felt */}
            <div
              className="poker-felt absolute rounded-full border-[10px] border-black/60 shadow-[inset_0_0_60px_rgba(0,0,0,0.45),0_20px_60px_rgba(0,0,0,0.5)]"
              style={{
                left: '15.8%',
                top: '14.9%',
                width: '68.7%',
                height: '73.3%',
              }}
            />

            {/* Dealer button — bottom-left corner of the acting dealer's seat */}
            {game?.dealerSeat != null && (
              <div
                data-testid="dealer-chip"
                data-seat={game.dealerSeat}
                className="absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/30 bg-white text-[10px] font-bold text-black shadow"
                style={seatCornerPosition(
                  game.dealerSeat,
                  table.maxSeats,
                  'left',
                )}
              >
                D
              </div>
            )}

            {/* Blind chips — the seats that posted this hand's small and big
                blind. They stay put for the whole hand, so it is still clear
                who posted once the blinds fold or act. */}
            {game != null &&
              (
                [
                  { seat: game.smallBlindSeat, label: 'SB' },
                  { seat: game.bigBlindSeat, label: 'BB' },
                ] as const
              ).map(({ seat, label }) =>
                seat == null ? null : (
                  <div
                    key={label}
                    data-testid={`blind-${label.toLowerCase()}`}
                    data-seat={seat}
                    className="absolute z-20 flex h-4 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-black/30 bg-white px-1 text-[9px] font-bold text-black shadow"
                    style={seatCornerPosition(seat, table.maxSeats, 'right')}
                  >
                    {label}
                  </div>
                ),
              )}

            {/* Pot — the main pot, with any side pots stacked above it. A
                side pot appears as soon as an all-in caps the main pot, and
                only the players who stayed in can win it. */}
            <div
              className="absolute left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1"
              style={{ bottom: '62%' }}
              data-testid="pots"
            >
              <AnimatePresence initial={false}>
                {sidePots.map((pot) => (
                  <motion.div
                    key={pot.level}
                    initial={{ opacity: 0, y: -10, scale: 0.9 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                  >
                    <Badge
                      variant="secondary"
                      data-testid="side-pot"
                      title={`Only ${pot.eligibleUserIds
                        .map(
                          (id) =>
                            seats.find((seat) => seat.userId === id)
                              ?.displayName ?? 'Player',
                        )
                        .join(', ')} can win this side pot`}
                      className="border-white/15 bg-black/55 text-[10px] text-white/85"
                    >
                      Side pot · {formatMoney(pot.amount)}
                    </Badge>
                  </motion.div>
                ))}
              </AnimatePresence>
              <Badge
                variant="outline"
                data-testid="pot"
                className="border-white/20 bg-black/40 text-white"
              >
                Pot · {formatMoney(mainPot)}
              </Badge>
            </div>

            {/* Community cards — flop */}
            <div
              className="absolute inset-x-0 flex justify-center gap-1.5"
              style={{ top: '41%' }}
              data-testid="community"
            >
              {[0, 1, 2].map((index) => (
                <div key={index} className="aspect-[36/49] w-9">
                  {flop[index] ? (
                    <PlayingCard card={flop[index]} className="size-full" />
                  ) : (
                    <CardBack className="size-full opacity-30" />
                  )}
                </div>
              ))}
            </div>

            {/* Community cards — turn + river */}
            <div
              className="absolute inset-x-0 flex justify-center gap-1.5"
              style={{ top: '49.4%' }}
              data-testid="community"
            >
              {[0, 1].map((index) => (
                <div key={index} className="aspect-[36/49] w-9">
                  {turnRiver[index] ? (
                    <PlayingCard
                      card={turnRiver[index]}
                      className="size-full"
                    />
                  ) : (
                    <CardBack className="size-full opacity-30" />
                  )}
                </div>
              ))}
            </div>

            {/* Seats — filled with the real humans at this table. Each seat
                shows its owner's hole cards when this viewer may see them. */}
            {Array.from({ length: table.maxSeats }, (_, index) => {
              const seat = table.seats.find((s) => s.seatIndex === index)
              const isYou = seat != null && seat.userId === user?.id
              return (
                <PokerSeat
                  key={index}
                  style={seatPosition(index, table.maxSeats)}
                  isYou={isYou}
                  player={
                    seat
                      ? {
                          name: seat.displayName,
                          money: seat.stack,
                          lastAction:
                            seat.lastAction ?? (isYou ? 'You' : 'Waiting…'),
                          status: seat.status,
                          bet: seat.bet,
                          folded: seat.folded,
                          allIn: seat.allIn,
                          isTurn:
                            game != null && game.turnUserId === seat.userId,
                          cards: seat.cards,
                        }
                      : undefined
                  }
                />
              )
            })}
          </div>
        )}
      </div>

      {/* Betting controls — under the table in portrait, beside it when the
          screen is wide but short, so the table can use the full height */}
      <div className="room-controls-panel shrink-0 border-t bg-card px-4 pt-3 pb-5 room-side:col-start-2 room-side:row-start-2 room-side:flex room-side:items-center room-side:border-t-0 room-side:border-l room-side:py-3">
        <div
          className="mx-auto flex w-full max-w-[420px] flex-col gap-3"
          data-testid="controls"
        >
          {!isWaiting && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {game?.currentBet ? 'Raise to' : 'Bet amount'}
                </span>
                <span className="font-medium tabular-nums">
                  {formatMoney(raiseRange ? raiseTarget : 0)}
                </span>
              </div>
              <Slider
                value={[raiseRange ? raiseTarget : 0]}
                min={raiseRange?.min ?? 0}
                max={raiseRange?.max ?? 1}
                step={Math.max(1, table?.smallBlind ?? 100)}
                disabled={!isMyTurn || raiseRange == null || pending}
                onValueChange={(value) => setBet(value[0] ?? 0)}
              />
            </>
          )}
          {isWaiting && seats.length < 2 ? (
            <RoomWaitingActions onInvite={() => setInviteOpen(true)} />
          ) : isWaiting ? (
            <Button
              className="w-full"
              disabled={pending || !mySeat || mySeat.ready || seats.length < 2}
              onClick={() => void sendAction({ type: 'ready' })}
            >
              {mySeat?.ready ? 'Ready — waiting for the others' : 'Ready'}
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2 room-side:grid-cols-2">
              <Button
                variant="outline"
                disabled={!isMyTurn || pending}
                onClick={() => void sendAction({ type: 'fold' })}
              >
                Fold
              </Button>
              <Button
                variant="secondary"
                disabled={callDisabled}
                onClick={onCall}
              >
                {canCheck
                  ? 'Check'
                  : callAmount != null
                    ? `Call ${formatMoney(callAmount)}`
                    : 'Check'}
              </Button>
              <Button
                disabled={raiseDisabled}
                onClick={() =>
                  void sendAction({ type: 'raise', amount: raiseTarget })
                }
              >
                {game?.currentBet ? 'Raise' : 'Bet'}
              </Button>
              <Button
                variant="destructive"
                disabled={allInDisabled}
                onClick={() => void sendAction({ type: 'allin' })}
              >
                All-in
              </Button>
            </div>
          )}
          <p
            data-testid="status"
            className={cn(
              'text-center text-xs',
              isMyTurn
                ? 'font-semibold text-amber-400'
                : 'text-muted-foreground',
            )}
          >
            {statusText}
          </p>
        </div>
      </div>
    </div>
  )
}
