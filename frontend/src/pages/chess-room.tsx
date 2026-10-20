import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
  FlagIcon,
  HandshakeIcon,
  Loader2Icon,
  LogOutIcon,
  MessageCircleIcon,
  ScrollTextIcon,
  UserPlusIcon,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { InviteFriendsDialog } from '@/components/invite-friends-dialog'
import { ChessBoard } from '@/components/chess-board'
import { ChessSeat, type ChessSeatPlayer } from '@/components/chess-seat'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  getApiStatus,
  tablesApi,
  type TableActionType,
} from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import {
  CHESS_GLYPHS,
  boardMaterial,
  capturedPieces,
} from '@/lib/chess'
import type {
  ChessColor,
  ChessEndReason,
  ChessPromotion,
  TableDetails,
} from '@/lib/types'
import { cn } from '@/lib/utils'

/** Chess moves take longer than a roll — poll often but not frantically. */
const POLL_INTERVAL_MS = 1200

/**
 * The room is laid out at this design size and scaled down as one unit, the
 * same trick the other rooms use, so the board can never spill over the
 * controls and the action buttons stay visible on any screen.
 */
const DESIGN_BOARD = 360
const DESIGN_STRIP = 54
/** The captured-pieces rail between the board and the legend. */
const DESIGN_CAPTURES = 22
const DESIGN_LEGEND = 30
const DESIGN_GAP = 10
const DESIGN_WIDTH = DESIGN_BOARD
const DESIGN_HEIGHT =
  DESIGN_STRIP +
  DESIGN_GAP +
  DESIGN_BOARD +
  DESIGN_GAP +
  DESIGN_CAPTURES +
  DESIGN_GAP +
  DESIGN_LEGEND

/** Captured pieces keep their side's shade, readable on the dark rail. */
const CAPTURED_WHITE = 'text-[#e7dfcb]'
const CAPTURED_BLACK = 'text-[#7d8b80]'

/** The phrase the result line uses for how the game ended. */
const END_REASONS: Record<ChessEndReason, string> = {
  checkmate: 'checkmate',
  stalemate: 'stalemate',
  resignation: 'resignation',
  abandoned: 'walkover',
  timeout: 'the clock',
  'fifty-move': 'the fifty-move rule',
  'insufficient-material': 'insufficient material',
  threefold: 'threefold repetition',
  agreement: 'agreement',
}

export function ChessRoomPage() {
  const { slug = 'chess', tableId = '' } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [table, setTable] = useState<TableDetails | null>(null)
  /** When the latest table snapshot arrived (for the turn timer). */
  const [fetchedAt, setFetchedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [pending, setPending] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [resignOpen, setResignOpen] = useState(false)
  const [movesOpen, setMovesOpen] = useState(false)
  const [boardZoom, setBoardZoom] = useState(1)
  const areaRef = useRef<HTMLDivElement>(null)
  const requestSeqRef = useRef(0)
  const shownResultRef = useRef('init')
  const shownDrawOfferRef = useRef<string | null>(null)

  const game = table?.game.kind === 'chess' ? table.game : null
  const seats = table?.seats ?? []
  const mySeat = seats.find((seat) => seat.userId === user?.id)
  const phase = game?.phase ?? 'waiting'
  const isPlaying = phase === 'playing'
  const isFinished = phase === 'finished'
  const legal = game?.legal ?? null
  const isMyTurn = isPlaying && legal != null
  const myPlayer = game?.players.find((player) => player.userId === user?.id)
  const myColor = myPlayer?.color ?? 'w'
  const drawOffer = game?.drawOffer ?? null
  const incomingOffer = drawOffer != null && drawOffer.userId !== user?.id
  const myOffer = drawOffer != null && drawOffer.userId === user?.id
  const offerName = seats.find(
    (seat) => seat.userId === drawOffer?.userId,
  )?.displayName

  // Scale the whole room down to fit: seats, board and legend shrink together.
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
      // (`/play/chess/table/<poker id>`). Follow the table's own game instead
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

  // Entering a chess table takes a seat (joining twice just keeps yours).
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

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh()
    }, POLL_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [refresh])

  const sendAction = useCallback(
    async (action: {
      type: TableActionType
      from?: string
      to?: string
      promotion?: ChessPromotion
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

  const winnerName = seats.find(
    (seat) => seat.userId === game?.winnerUserId,
  )?.displayName
  const turnName = seats.find((seat) => seat.userId === game?.turnUserId)
    ?.displayName

  // Announce the result once per game (never for history on first load).
  useEffect(() => {
    if (!game || game.phase !== 'finished') return
    const key = `t${table?.id}:g${game.gameNumber}`
    if (shownResultRef.current === 'init') {
      shownResultRef.current = key
      return
    }
    if (shownResultRef.current === key) return
    shownResultRef.current = key
    if (game.result?.draw) {
      toast.success('The game is drawn — ready up for another.')
    } else {
      toast.success(winnerName ? `${winnerName} won the game!` : 'Game over')
    }
  }, [game, table?.id, winnerName])

  // A gentle nudge when it is your move.
  useEffect(() => {
    if (isMyTurn) {
      toast.info('Your move', { id: 'chess-your-turn-toast' })
    } else {
      toast.dismiss('chess-your-turn-toast')
    }
  }, [isMyTurn])

  // One toast per offer — the banner in the controls is the lasting signal.
  useEffect(() => {
    if (!game || game.drawOffer == null || game.drawOffer.userId === user?.id) {
      return
    }
    const key = `t${table?.id}:g${game.gameNumber}:o${game.drawOffer.userId}`
    if (shownDrawOfferRef.current === key) return
    shownDrawOfferRef.current = key
    toast.info('Your friend offers a draw — accept it or keep playing.')
  }, [game, table?.id, user?.id])

  const turnRemainingMs =
    game?.turnDeadline != null
      ? Math.max(0, game.turnDeadline - game.serverNow - (now - fetchedAt))
      : null

  /** A side's bank: the side on the move counts down, the other one waits. */
  const clockMsFor = (color: ChessColor): number | null => {
    if (!game) return null
    if (isPlaying && game.turn === color && turnRemainingMs != null) {
      return turnRemainingMs
    }
    return game.clocks[color]
  }

  const captures = capturedPieces(game?.moves ?? [])
  const material = boardMaterial(game?.board ?? [])
  const whiteAdvantage = material.w - material.b

  /** A castle the player may play right now — the king steps two squares. */
  const castle = (game?.legal?.moves ?? []).find((move) => move.castle) ?? null

  let statusText = ''
  if (table) {
    if (isPlaying) {
      if (isMyTurn) {
        statusText = game?.inCheck
          ? 'Your king is in check — defend it!'
          : castle
            ? `Your move — castling is available (${castle.to})`
            : 'Your move'
      } else if (turnName) {
        statusText = `Waiting for ${turnName}…`
      }
    } else if (isFinished) {
      const result = game?.result
      if (!result) {
        statusText = 'Game over — ready up for the next one.'
      } else if (result.draw) {
        statusText = `Draw by ${END_REASONS[result.reason]} — ready up for another.`
      } else {
        statusText = winnerName
          ? `${winnerName} wins by ${END_REASONS[result.reason]} — ready up for another.`
          : 'Game over — ready up for another.'
      }
    } else if (seats.length < 2) {
      statusText = 'Waiting for one more player to take a seat.'
    } else if (mySeat?.ready) {
      statusText = 'You are ready — waiting for your friend.'
    } else {
      statusText = 'Both seats taken — tap Ready to start the clocks.'
    }
  }

  const playerBySeat = new Map(
    (game?.players ?? []).map((player) => [player.seatIndex, player]),
  )
  const lastMove = game?.moves.at(-1) ?? null

  let legend = 'Castling, en passant and promotion are all played out by the server.'
  if (isPlaying && game) {
    const side = game.turn === 'w' ? 'White' : 'Black'
    legend = `${side} to move · move ${game.fullmoveNumber}${
      lastMove ? ` · last ${lastMove.san}` : ''
    }`
  } else if (isFinished && game?.result) {
    // White's win reads 1–0 and Black's 0–1, the way chess scores are written.
    const score = game.result.draw
      ? '½–½'
      : game.players.find((player) => player.userId === game.winnerUserId)
            ?.color === 'b'
        ? '0–1'
        : '1–0'
    legend = game.result.draw
      ? `${score} · drawn by ${END_REASONS[game.result.reason]}`
      : `${score} · ${winnerName ?? 'the winner'} wins by ${END_REASONS[game.result.reason]}`
  }

  const seatCards = Array.from({ length: table?.maxSeats ?? 2 }, (_, index) => {
    const seat = seats.find((s) => s.seatIndex === index)
    if (!seat) return <ChessSeat key={index} />
    const player = playerBySeat.get(index)
    const seatPlayer: ChessSeatPlayer = {
      name: seat.displayName,
      color: player?.color ?? null,
      ready: seat.ready,
      status: seat.status,
      isTurn: game?.turnUserId === seat.userId,
      isYou: seat.userId === user?.id,
      inGame: player != null,
      winner: game?.winnerUserId === seat.userId,
      // Before colours are drawn both seats show the opening bank.
      clockMs: player
        ? clockMsFor(player.color)
        : (game?.timeControl.initialMs ?? null),
    }
    return <ChessSeat key={index} player={seatPlayer} />
  })

  const canReady =
    mySeat != null && !mySeat.ready && seats.length >= 2 && !isPlaying

  return (
    <div className="grid h-[100dvh] grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-background room-side:grid-cols-[minmax(0,1fr)_minmax(240px,46%)] room-side:grid-rows-[auto_minmax(0,1fr)]">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-2 border-b bg-card px-3 py-2.5 room-side:col-span-2">
        <Button variant="ghost" size="icon" asChild>
          <Link to={`/play/${slug}`} aria-label="Back to tables">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 flex-col items-center">
          <span className="max-w-full truncate text-sm leading-tight font-semibold">
            {table?.name ?? 'Chess'}
          </span>
          <span className="text-[10px] leading-tight font-medium tracking-[0.18em] text-muted-foreground uppercase">
            {game ? `Chess · ${game.timeControl.id}` : 'Chess'}
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
                    ? `${table.seats.length} · ${table.maxSeats} seated · Chess`
                    : 'Loading…'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isPlaying && (
              <>
                <DropdownMenuItem onSelect={() => setResignOpen(true)}>
                  <FlagIcon />
                  Resign
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem onSelect={() => setMovesOpen(true)}>
              <ScrollTextIcon />
              Move list
            </DropdownMenuItem>
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
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 room-side:col-start-1 room-side:row-start-2"
      >
        {table === null ? (
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <div
            className="flex flex-col items-center"
            style={{ zoom: boardZoom, gap: DESIGN_GAP, width: DESIGN_WIDTH }}
          >
            <div
              data-testid="chess-seats"
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
              <ChessBoard
                board={game?.board ?? []}
                myColor={myColor}
                legal={legal}
                lastMove={game?.lastMove ?? null}
                checkedColor={game?.inCheck ? game.turn : null}
                interactive={isMyTurn && !pending}
                onMove={(from, to, promotion) =>
                  void sendAction({ type: 'move', from, to, promotion })
                }
              />
            </div>

            {/* Captured pieces and material: White's tray on the left, Black's
                on the right, with the pawns one side is up in the middle. */}
            <div
              data-testid="chess-captures"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-card/60 px-2 leading-none"
              style={{ height: DESIGN_CAPTURES }}
            >
              <span className="flex min-w-0 items-center gap-0.5 overflow-hidden text-[13px]">
                {captures.w.map((type, index) => (
                  <span key={`w-${type}-${index}`} className={CAPTURED_BLACK}>
                    {CHESS_GLYPHS[type]}
                  </span>
                ))}
                {whiteAdvantage > 0 && (
                  <span className="ml-1 text-[10px] font-semibold text-foreground tabular-nums">
                    +{whiteAdvantage}
                  </span>
                )}
              </span>
              <span className="flex min-w-0 items-center justify-end gap-0.5 overflow-hidden text-[13px]">
                {whiteAdvantage < 0 && (
                  <span className="mr-1 text-[10px] font-semibold text-foreground tabular-nums">
                    +{-whiteAdvantage}
                  </span>
                )}
                {captures.b.map((type, index) => (
                  <span key={`b-${type}-${index}`} className={CAPTURED_WHITE}>
                    {CHESS_GLYPHS[type]}
                  </span>
                ))}
              </span>
            </div>

            <p
              data-testid="chess-legend"
              className="line-clamp-2 text-center text-[11px] leading-[1.4] text-muted-foreground"
            >
              {legend}
            </p>
          </div>
        )}
      </div>

      {/* Controls — under the board in portrait, beside it when the screen is
          wide but short, so the board can use the full height */}
      <div className="shrink-0 border-t bg-card px-4 pt-3 pb-5 room-side:col-start-2 room-side:row-start-2 room-side:flex room-side:items-center room-side:border-t-0 room-side:border-l room-side:py-3">
        <div
          className="mx-auto flex w-full max-w-[420px] flex-col gap-3"
          data-testid="controls"
        >
          <div className="flex items-center gap-2">
            <p
              data-testid="status"
              className={cn(
                'min-w-0 flex-1 text-sm',
                isMyTurn
                  ? 'font-semibold text-amber-500'
                  : 'text-muted-foreground',
              )}
            >
              {statusText}
            </p>
            {isPlaying && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || !myPlayer || drawOffer != null}
                  onClick={() => void sendAction({ type: 'offer_draw' })}
                  data-testid="offer-draw"
                >
                  <HandshakeIcon />
                  {myOffer ? 'Offered' : 'Draw'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => setResignOpen(true)}
                  data-testid="resign"
                >
                  <FlagIcon />
                  Resign
                </Button>
              </>
            )}
          </div>

          {isPlaying ? (
            incomingOffer ? (
              <div
                className="flex items-center gap-2 rounded-xl border border-sky-500/50 bg-sky-500/5 px-3 py-2"
                data-testid="draw-offer"
              >
                <HandshakeIcon className="size-4 shrink-0 text-sky-400" />
                <p className="min-w-0 flex-1 text-xs">
                  {offerName ?? 'Your friend'} offers a draw.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => void sendAction({ type: 'decline_draw' })}
                  data-testid="decline-draw"
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() => void sendAction({ type: 'accept_draw' })}
                  data-testid="accept-draw"
                >
                  Accept
                </Button>
              </div>
            ) : isMyTurn ? (
              <div
                className={cn(
                  'rounded-xl border border-dashed px-3 py-2.5 text-center text-xs',
                  game?.inCheck
                    ? 'border-red-500/60 text-red-400'
                    : 'text-muted-foreground',
                )}
              >
                {game?.inCheck
                  ? 'Move your king, block the check or capture the attacker.'
                  : 'Pick one of your pieces, then tap a highlighted square.'}
              </div>
            ) : (
              <Button className="w-full" variant="outline" disabled>
                {myOffer
                  ? 'Draw offered — waiting for your friend…'
                  : `Waiting for ${turnName ?? 'your friend'}…`}
              </Button>
            )
          ) : (
            <Button
              className="w-full"
              size="lg"
              data-testid="ready"
              disabled={pending || !canReady}
              onClick={() => void sendAction({ type: 'ready' })}
            >
              {mySeat?.ready
                ? 'Ready — waiting for your friend'
                : isFinished
                  ? 'Ready for a rematch'
                  : 'Ready'}
            </Button>
          )}
        </div>
      </div>

      {/* Move list — the full game in SAN, newest move highlighted */}
      <Dialog open={movesOpen} onOpenChange={setMovesOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Move list</DialogTitle>
            <DialogDescription>
              {game?.moves.length
                ? `${game.moves.length} ${game.moves.length === 1 ? 'ply' : 'plies'} — the last move is highlighted.`
                : 'No moves yet.'}
            </DialogDescription>
          </DialogHeader>
          <div
            className="max-h-[55vh] overflow-y-auto rounded-lg border"
            data-testid="move-list"
          >
            {game?.moves.length ? (
              <div className="divide-y divide-border/60">
                {Array.from(
                  { length: Math.ceil(game.moves.length / 2) },
                  (_, row) => {
                    const white = game.moves[row * 2]
                    const black = game.moves[row * 2 + 1]
                    const lastIndex = game.moves.length - 1
                    return (
                      <div
                        key={row}
                        className="grid grid-cols-[2.25rem_1fr_1fr] items-center gap-1 px-2 py-1 text-xs"
                      >
                        <span className="text-muted-foreground tabular-nums">
                          {row + 1}.
                        </span>
                        <span
                          className={cn(
                            row * 2 === lastIndex &&
                              'rounded bg-amber-400/20 px-1 font-semibold',
                          )}
                        >
                          {white?.san ?? ''}
                        </span>
                        <span
                          className={cn(
                            row * 2 + 1 === lastIndex &&
                              'rounded bg-amber-400/20 px-1 font-semibold',
                          )}
                        >
                          {black?.san ?? ''}
                        </span>
                      </div>
                    )
                  },
                )}
              </div>
            ) : (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                The first move starts the clock.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Resign confirmation */}
      <Dialog open={resignOpen} onOpenChange={setResignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Resign this game?</DialogTitle>
            <DialogDescription>
              Your friend takes the win immediately. The table stays open for a
              rematch.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResignOpen(false)}>
              Keep playing
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setResignOpen(false)
                void sendAction({ type: 'resign' })
              }}
            >
              Resign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
