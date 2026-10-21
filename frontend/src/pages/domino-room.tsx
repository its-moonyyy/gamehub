import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  BlocksIcon,
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
import { DominoPiece } from '@/components/domino-piece'
import { DominoSeat, type DominoSeatPlayer } from '@/components/domino-seat'
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
import {
  getApiErrorMessage,
  getApiStatus,
  tablesApi,
  type TableActionType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import type { DominoesEnd, TableDetails } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLiveTable } from '@/lib/use-live-table'

/** Dominoes turns arrive through live invalidation and deadline wakeups. */

/**
 * The room is laid out at this design size and scaled down as one unit, the
 * same trick the poker table and Ludo board use, so the hand can never spill
 * over the controls and the action buttons stay visible on any screen.
 */
const DESIGN_WIDTH = 430
const DESIGN_SEATS = 54
const DESIGN_BOARD = 246
/** Just tall enough for a standing hand — the tiles are twice as tall as wide. */
const DESIGN_HAND = 100
const DESIGN_LEGEND = 20
const DESIGN_GAP = 10
const DESIGN_HEIGHT =
  DESIGN_SEATS + DESIGN_GAP + DESIGN_BOARD + DESIGN_GAP + DESIGN_HAND + DESIGN_GAP + DESIGN_LEGEND

/**
 * The tile the table plays with. The chain shrinks below it once the board
 * gets crowded, but the player's rack keeps this size.
 */
const TABLE_TILE_WIDTH = 70

/**
 * The player's rack is a shade smaller than the table's tiles — big enough to
 * read at a glance, small enough to hold seven of them side by side.
 */
const HAND_TILE_WIDTH = 35.5

/** The clear space between two tiles in the rack. */
const HAND_GAP = 8

/**
 * The boneyard on the table: three face-down tiles fanned out at the edge of
 * the table, lying flat like the chain.
 */
const BONEYARD_PILE = [0, -8, -16]
const BONEYARD_TILTS = [6, 0, -7]

/**
 * The widest tile that fits `count` dominoes into a box, wrapping into rows.
 * `ratio` is the tile height per unit of width (0.5 lying down, 2 standing
 * up). Keeping the whole chain or hand on the board is the point — the panel
 * never scrolls.
 */
function fitTileWidth(
  count: number,
  width: number,
  height: number,
  maxWidth: number,
  minWidth: number,
  gap: number,
  ratio = 0.5,
): number {
  if (count <= 0) return maxWidth
  for (let tile = maxWidth; tile >= minWidth; tile -= 2) {
    const columns = Math.max(1, Math.floor((width + gap) / (tile + gap)))
    const rows = Math.ceil(count / columns)
    const tileHeight = tile * ratio
    if (rows * (tileHeight + gap) - gap <= height) {
      return tile
    }
  }
  return minWidth
}

/**
 * The player's rack: the very tiles the table plays with, standing up in a fan.
 * When there are more tiles than fit in one row they overlap like a hand of
 * dominoes — but never so much that a tile hides the pips of its neighbour
 * (the right-hand pip column of a tile sits at 7/8 of its width). `gap` is the
 * clear space between two tiles.
 */
function fitHandTiles(
  count: number,
  width: number,
  gap: number,
  maxTile: number,
  minTile: number,
): { tileWidth: number; overlap: number } {
  if (count <= 1) return { tileWidth: maxTile, overlap: 0 }
  for (let tile = maxTile; tile >= minTile; tile -= 2) {
    const needed = (count * tile + (count - 1) * gap - width) / (count - 1)
    if (needed <= 0) return { tileWidth: tile, overlap: 0 }
    if (needed <= tile * 0.11) return { tileWidth: tile, overlap: needed }
  }
  return { tileWidth: minTile, overlap: minTile * 0.11 }
}

/** The end a move would leave open, for the two-ended choice buttons. */
function resultingEnd(
  end: DominoesEnd,
  tile: { a: number; b: number },
  leftEnd: number | null,
  rightEnd: number | null,
): number | null {
  if (end === 'left') {
    if (leftEnd == null) return null
    return tile.a === leftEnd ? tile.b : tile.a
  }
  if (end === 'right') {
    if (rightEnd == null) return null
    return tile.a === rightEnd ? tile.b : tile.a
  }
  return null
}

export function DominoRoomPage() {
  const { slug = 'dominoes', tableId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [table, setTable] = useState<TableDetails | null>(null)
  /** When the latest table snapshot arrived (for the turn timer). */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [requestedTile, setRequestedTile] = useState<number | null>(null)
  const [boardZoom, setBoardZoom] = useState(1)
  const areaRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)
  const shownResultRef = useRef('init')

  const game = table?.game.kind === 'dominoes' ? table.game : null
  const seats = table?.seats ?? []
  const mySeat = seats.find((seat) => seat.userId === user?.id)
  const phase = game?.phase ?? 'waiting'
  const isPlaying = phase === 'playing'
  const isFinished = phase === 'finished'
  const legal = game?.legal ?? null
  const isMyTurn = isPlaying && legal != null
  const hand = game?.hand ?? []
  const chain = game?.chain ?? []
  /** Tiles still face down in the boneyard — drawn as a stack on the table. */
  const boneyardCount = game?.boneyardCount ?? 0
  const boneyardVisible = boneyardCount > 0
  // A half-finished tile choice dies with the turn: it is only kept while the
  // server still offers it as a legal move, so no effect has to clear it.
  const selectedTile =
    requestedTile != null &&
    (legal?.moves ?? []).some((move) => move.tileId === requestedTile)
      ? requestedTile
      : null
  const selectedMoves =
    selectedTile == null
      ? []
      : (legal?.moves ?? []).filter((move) => move.tileId === selectedTile)

  // Scale the whole room down to fit: seats, chain and hand shrink together.
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
      // (`/play/dominoes/table/<poker id>`). Follow the table's own game
      // instead of drawing it through the wrong room's UI.
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

  // Entering a Dominoes table takes a seat (joining twice just keeps yours).
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
    async (action: {
      type: TableActionType
      tileId?: number
      end?: DominoesEnd
    }) => {
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

  /** Tapping a tile plays it when there is only one end it can go on. */
  function handleTileClick(tileId: number) {
    const moves = (legal?.moves ?? []).filter((move) => move.tileId === tileId)
    if (moves.length === 0) return
    if (moves.length === 1) {
      setRequestedTile(null)
      void sendAction({ type: 'play', tileId, end: moves[0]?.end })
      return
    }
    setRequestedTile((current) => (current === tileId ? null : tileId))
  }

  const winnerNames = (game?.winnerUserIds ?? []).map(
    (id) => seats.find((seat) => seat.userId === id)?.displayName ?? 'Player',
  )
  const turnName = seats.find((seat) => seat.userId === game?.turnUserId)
    ?.displayName

  // Announce the result once per round (never for history on first load).
  useEffect(() => {
    const dominoes = table?.game.kind === 'dominoes' ? table.game : null
    if (
      !table ||
      !dominoes ||
      dominoes.phase !== 'finished' ||
      dominoes.winnerUserIds.length === 0
    ) {
      return
    }
    const key = `t${table.id}:g${dominoes.gameNumber}`
    if (shownResultRef.current === 'init') {
      shownResultRef.current = key
      return
    }
    if (shownResultRef.current === key) return
    shownResultRef.current = key
    const names = dominoes.winnerUserIds
      .map(
        (id) =>
          table.seats.find((seat) => seat.userId === id)?.displayName ??
          'Player',
      )
      .join(' & ')
    const reason =
      dominoes.resultReason === 'blocked'
        ? ' — fewest pips left'
        : dominoes.resultReason === 'forfeit'
          ? ' — last player standing'
          : ' — empty hand'
    toast.success(`${names} won${reason}`)
  }, [table])

  // A gentle nudge when it is your turn.
  useEffect(() => {
    if (isMyTurn) {
      toast.info('Your turn', { id: 'dominoes-your-turn-toast' })
    } else {
      toast.dismiss('dominoes-your-turn-toast')
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
      const hasMove = (legal?.moves.length ?? 0) > 0
      if (isMyTurn) {
        statusText = hasMove
          ? 'Your turn — play a highlighted tile'
          : legal?.draw
            ? 'No tile fits — draw from the boneyard'
            : 'No tile fits and the boneyard is empty — pass'
      } else if (turnName) {
        statusText = `Waiting for ${turnName}…`
      }
    } else if (isFinished) {
      if (winnerNames.length > 0) {
        statusText =
          game?.resultReason === 'blocked'
            ? `${winnerNames.join(' & ')} had the fewest pips — ready up for a rematch.`
            : game?.resultReason === 'forfeit'
              ? `${winnerNames.join(' & ')} wins — ready up for a rematch.`
              : `${winnerNames.join(' & ')} emptied their hand — ready up for a rematch.`
      } else {
        statusText = 'The round is over — ready up for the next one.'
      }
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

  const seatCards = Array.from({ length: table?.maxSeats ?? 4 }, (_, index) => {
    const seat = seats.find((s) => s.seatIndex === index)
    if (!seat) return <DominoSeat key={index} />
    const player = playerBySeat.get(index)
    const seatPlayer: DominoSeatPlayer = {
      name: seat.displayName,
      ready: seat.ready,
      status: seat.status,
      isTurn: game?.turnUserId === seat.userId,
      isYou: seat.userId === user?.id,
      inGame: player != null,
      handCount: player?.handCount ?? 0,
      winner: game?.winnerUserIds.includes(seat.userId) ?? false,
    }
    return <DominoSeat key={index} player={seatPlayer} />
  })

  const canReady =
    mySeat != null && !mySeat.ready && seats.length >= 2 && !isPlaying
  // The hand stands upright in a fan, using the very tiles the table plays
  // with — overlapped just enough to keep the whole rack on screen.
  const { tileWidth: handTileWidth, overlap: handOverlap } = fitHandTiles(
    hand.length,
    // A few pixels of slack, so the last tile can never tip over the edge.
    DESIGN_WIDTH - 4,
    HAND_GAP,
    HAND_TILE_WIDTH,
    24,
  )
  const chainTileWidth = fitTileWidth(
    chain.length,
    DESIGN_WIDTH - 16,
    DESIGN_BOARD - 34,
    TABLE_TILE_WIDTH,
    24,
    5,
  )
  const movable = new Set((legal?.moves ?? []).map((move) => move.tileId))
  const selectedPiece = hand.find((tile) => tile.id === selectedTile)

  return (
    <div data-game="dominoes" className="glass-game-shell grid h-[100dvh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background room-side:grid-cols-[minmax(0,1fr)_minmax(240px,46%)] room-side:grid-rows-[auto_minmax(0,1fr)]">
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
                    ? `${table.seats.length} · ${table.maxSeats} seated · Dominoes`
                    : 'Loading…'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-4 px-2 py-1.5">
              <span className="text-xs text-muted-foreground">Wallet balance</span>
              <PlayerWalletBadge />
            </div>
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
              data-testid="dominoes-seats"
              className="grid w-full gap-1.5"
              style={{
                gridTemplateColumns: `repeat(${table.maxSeats}, minmax(0, 1fr))`,
                height: DESIGN_SEATS,
              }}
            >
              {seatCards}
            </div>

            <div
              className="relative flex shrink-0 flex-col rounded-2xl border border-white/10 bg-[#10171510] px-3 py-2"
              style={{ width: DESIGN_WIDTH, height: DESIGN_BOARD }}
            >
              <div className="flex w-full shrink-0 items-center justify-between">
                <Badge variant="outline" data-testid="dominoes-left-end">
                  Left {game?.leftEnd ?? '—'}
                </Badge>
                <span className="text-[10px] tracking-[0.18em] text-muted-foreground uppercase">
                  Boneyard {game?.boneyardCount ?? 0}
                </span>
                <Badge variant="outline" data-testid="dominoes-right-end">
                  Right {game?.rightEnd ?? '—'}
                </Badge>
              </div>

              <div
                className="relative z-10 flex min-h-0 flex-1 items-center justify-center"
              >
                {chain.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <BlocksIcon className="size-8" />
                    <p className="px-6 text-center text-xs">
                      {isPlaying
                        ? isMyTurn
                          ? 'Open the chain — play any tile from your hand.'
                          : `${turnName ?? 'The starter'} opens the chain.`
                        : 'The chain is empty.'}
                    </p>
                  </div>
                ) : (
                  <div
                    data-testid="dominoes-chain"
                    className="flex w-full flex-wrap content-center items-center justify-center"
                    style={{ gap: 5 }}
                  >
                    {chain.map((entry, index) => {
                      const isLeftEnd = index === 0
                      const isRightEnd = index === chain.length - 1
                      return (
                        <div
                          key={`${entry.tileId}-${index}`}
                          data-testid="dominoes-chain-tile"
                          data-tile={entry.tileId}
                          className={cn(
                            'rounded-[6px] transition-shadow',
                            (isLeftEnd || isRightEnd) &&
                              'ring-2 ring-amber-400/60',
                          )}
                          style={{ width: chainTileWidth }}
                        >
                          <DominoPiece a={entry.left} b={entry.right} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* The boneyard on the table: a face-down stack of the very tiles
                  the chain is played with. It sits under the chain, so a long
                  chain can never hide a played tile. */}
              {boneyardVisible && (
                <div
                  aria-hidden
                  data-testid="dominoes-boneyard"
                  className="pointer-events-none absolute"
                  style={{
                    right: 6,
                    bottom: 6,
                    width: chainTileWidth + 24,
                    height: chainTileWidth / 2 + 14,
                  }}
                >
                  {BONEYARD_PILE.map((offset, index) => (
                    <div
                      key={offset}
                      className="absolute bottom-0 right-0 drop-shadow-[0_6px_10px_rgba(0,0,0,0.5)]"
                      style={{
                        transform: `translateX(${offset}px) rotate(${BONEYARD_TILTS[index]}deg)`,
                        opacity: 0.96 - index * 0.08,
                        zIndex: BONEYARD_PILE.length - index,
                      }}
                    >
                      <DominoPiece
                        a={0}
                        b={0}
                        faceDown
                        style={{
                          width: chainTileWidth,
                          height: chainTileWidth / 2,
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              data-testid="dominoes-hand"
              className="flex flex-wrap content-center items-center justify-center"
              style={{ width: DESIGN_WIDTH, height: DESIGN_HAND, gap: HAND_GAP }}
            >
              {hand.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {isPlaying ? 'Your hand is empty.' : 'Your tiles appear here.'}
                </p>
              ) : (
                hand.map((tile, index) => {
                  const playable = movable.has(tile.id)
                  const selected = selectedTile === tile.id
                  return (
                    <Button
                      key={tile.id}
                      type="button"
                      variant="ghost"
                      data-testid="dominoes-hand-tile"
                      data-tile={tile.id}
                      data-playable={playable}
                      aria-pressed={selected}
                      disabled={!playable || pending}
                      onClick={() => handleTileClick(tile.id)}
                      className={cn(
                        'h-auto w-auto shrink-0 rounded-[6px] p-0 hover:bg-transparent',
                        'focus-visible:ring-2 focus-visible:ring-ring',
                        playable
                          ? 'shadow-[0_0_14px_rgba(251,191,36,0.28)] ring-2 ring-amber-400/80'
                          : 'opacity-40 grayscale-[0.25]',
                        selected &&
                          '-translate-y-1 shadow-[0_0_16px_rgba(52,211,153,0.45)] ring-2 ring-emerald-400',
                      )}
                      style={{
                        width: handTileWidth,
                        height: handTileWidth * 2,
                        // The fan: every tile slides over the one before it.
                        marginLeft: index === 0 ? 0 : -handOverlap,
                        zIndex: index,
                      }}
                    >
                      <DominoPiece
                        a={tile.a}
                        b={tile.b}
                        vertical
                        // Inline size on purpose: the shadcn Button's icon
                        // rule would shrink the svg to 16px otherwise.
                        style={{
                          width: handTileWidth,
                          height: handTileWidth * 2,
                        }}
                      />
                    </Button>
                  )
                })
              )}
            </div>

            <p
              data-testid="dominoes-legend"
              className="text-center text-[11px] leading-[1.4] text-muted-foreground"
            >
              Match either open end · nothing fits? draw · a full lap of passes
              blocks the round
            </p>
          </div>
        )}
      </div>

      {/* Hand + controls — under the board in portrait, beside it when the
          screen is wide but short, so the board can use the full height */}
      <div className="room-controls-panel shrink-0 border-t bg-card px-4 pt-3 pb-5 room-side:col-start-2 room-side:row-start-2 room-side:flex room-side:items-center room-side:border-t-0 room-side:border-l room-side:py-3">
        <div
          className="mx-auto flex w-full max-w-[440px] flex-col gap-2.5"
          data-testid="controls"
        >
          <div className="flex items-center justify-between gap-3">
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
            {isPlaying && (
              <Badge variant="secondary" className="shrink-0">
                Boneyard {game?.boneyardCount ?? 0}
              </Badge>
            )}
          </div>

          {isPlaying ? (
            isMyTurn && selectedMoves.length > 1 && selectedPiece ? (
              <div className="grid grid-cols-2 gap-2">
                {selectedMoves.map((move) => {
                  const end =
                    resultingEnd(
                      move.end,
                      selectedPiece,
                      game?.leftEnd ?? null,
                      game?.rightEnd ?? null,
                    ) ?? 0
                  return (
                    <Button
                      key={move.end}
                      disabled={pending}
                      onClick={() =>
                        void sendAction({
                          type: 'play',
                          tileId: selectedPiece.id,
                          end: move.end,
                        })
                      }
                    >
                      Play {move.end} · {end}
                    </Button>
                  )
                })}
              </div>
            ) : isMyTurn && legal?.draw ? (
              <Button
                className="w-full"
                size="lg"
                disabled={pending}
                data-testid="draw"
                onClick={() => void sendAction({ type: 'draw' })}
              >
                Draw a tile
              </Button>
            ) : isMyTurn && legal?.pass ? (
              <Button
                className="w-full"
                size="lg"
                variant="secondary"
                disabled={pending}
                data-testid="pass"
                onClick={() => void sendAction({ type: 'pass' })}
              >
                Pass
              </Button>
            ) : isMyTurn ? (
              <div className="rounded-xl border border-dashed px-3 py-2.5 text-center text-xs text-muted-foreground">
                Tap one of your highlighted tiles to play it.
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
