import { useState } from 'react'
import { motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CHESS_DARK_SQUARE,
  CHESS_GLYPHS,
  CHESS_LIGHT_SQUARE,
  CHESS_PIECE_NAMES,
  boardOrder,
  indexToSquare,
  isLightSquare,
  pieceKey,
  squareIndex,
} from '@/lib/chess'
import type {
  ChessColor,
  ChessLegalActions,
  ChessPiece,
  ChessPromotion,
} from '@/lib/types'
import { cn } from '@/lib/utils'

const LIGHT_SQUARE = CHESS_LIGHT_SQUARE
const DARK_SQUARE = CHESS_DARK_SQUARE

/** The order the promotion dialog offers the pieces in. */
const PROMOTION_CHOICES: ChessPromotion[] = ['q', 'r', 'b', 'n']

interface ChessBoardProps {
  /** 64 squares, 0 = a8 ... 63 = h1. */
  board: (ChessPiece | null)[]
  /** The colour the viewer plays — black sees the board from the far side. */
  myColor: ChessColor
  /** The viewer's legal moves; null while the other player is on the clock. */
  legal: ChessLegalActions | null
  /** Squares of the last move, tinted so both players can follow it. */
  lastMove: { from: string; to: string } | null
  /** The colour of the king that is in check right now, or null. */
  checkedColor: ChessColor | null
  /** It is the viewer's turn and the server is not busy. */
  interactive: boolean
  onMove: (from: string, to: string, promotion?: ChessPromotion) => void
  className?: string
}

/**
 * The 8x8 board. Every position is drawn from the server's square array, so
 * two browsers can never disagree about the game — the box only ever sends
 * the squares of a move the server already listed as legal.
 */
export function ChessBoard({
  board,
  myColor,
  legal,
  lastMove,
  checkedColor,
  interactive,
  onMove,
  className,
}: ChessBoardProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [promotion, setPromotion] = useState<{
    from: string
    to: string
  } | null>(null)

  const isMyTurn = interactive && legal != null

  const checkedKing =
    checkedColor == null
      ? -1
      : board.findIndex(
          (piece) => piece?.type === 'k' && piece.color === checkedColor,
        )
  const checkedSquare = checkedKing >= 0 ? indexToSquare(checkedKing) : null

  // One hint per destination: promotion moves collapse into a single target.
  const targets = new Set<string>()
  // A castle is the one move a king cannot make with a single step, so it
  // gets its own mark — the player must see that g1 means "castle".
  const castles = new Set<string>()
  if (selected && legal) {
    for (const move of legal.moves) {
      if (move.from !== selected) continue
      targets.add(move.to)
      if (move.castle) {
        castles.add(move.to)
      }
    }
  }

  function handleSquare(square: string) {
    if (!isMyTurn || !legal) {
      return
    }
    const piece = board[squareIndex(square)]

    if (selected) {
      const candidates = legal.moves.filter(
        (move) => move.from === selected && move.to === square,
      )
      if (candidates.length > 0) {
        if (candidates.some((move) => move.promotion != null)) {
          setPromotion({ from: selected, to: square })
          return
        }
        onMove(selected, square)
        setSelected(null)
        return
      }
    }

    if (piece && piece.color === myColor) {
      const canMove = legal.moves.some((move) => move.from === square)
      setSelected(canMove ? square : null)
      return
    }

    setSelected(null)
  }

  function confirmPromotion(type: ChessPromotion) {
    if (!promotion) return
    onMove(promotion.from, promotion.to, type)
    setPromotion(null)
    setSelected(null)
  }

  return (
    <div
      className={cn(
        'relative size-full overflow-hidden rounded-lg border border-white/10 shadow-xl shadow-black/30',
        className,
      )}
      style={{ backgroundColor: DARK_SQUARE }}
    >
      <div
        data-testid="chess-board"
        className="grid size-full grid-cols-8 grid-rows-8"
      >
        {boardOrder(myColor).map((index) => {
          const square = indexToSquare(index)
          const piece = board[index] ?? null
          const light = isLightSquare(square)
          const file = square[0]
          const rank = square[1]
          const selectedHere = selected === square
          const isTarget = targets.has(square)
          const capture = isTarget && piece != null
          const isLast = lastMove?.from === square || lastMove?.to === square
          const isChecked = checkedSquare === square
          const showRank = myColor === 'w' ? file === 'a' : file === 'h'
          const showFile = myColor === 'w' ? rank === '1' : rank === '8'

          return (
            <Button
              key={square}
              type="button"
              variant="ghost"
              data-square={square}
              data-piece={
                piece ? pieceKey(piece.color, piece.type) : undefined
              }
              disabled={!isMyTurn}
              onClick={() => handleSquare(square)}
              aria-label={
                piece
                  ? `${square}, ${piece.color === 'w' ? 'white' : 'black'} ${CHESS_PIECE_NAMES[piece.type]}`
                  : square
              }
              // A board square, not a pill: everything the Button brings
              // (height, padding, hover tint, press nudge, disabled fade) is
              // flattened so the grid keeps its exact squares.
              className={cn(
                'relative size-full items-center justify-center rounded-none border-0 p-0 font-normal hover:bg-transparent active:translate-y-0! disabled:opacity-100',
                isMyTurn && 'cursor-pointer',
                selectedHere && 'z-20',
              )}
              style={{ backgroundColor: light ? LIGHT_SQUARE : DARK_SQUARE }}
            >
              {/* The last move stays tinted under everything else. */}
              {isLast && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-amber-400/35"
                />
              )}
              {isChecked && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 bg-red-600/55"
                  animate={{ opacity: [0.45, 0.9, 0.45] }}
                  transition={{
                    duration: 1.6,
                    repeat: Infinity,
                    ease: 'easeInOut',
                  }}
                />
              )}
              {selectedHere && (
                <span
                  aria-hidden
                  className="absolute inset-0 ring-2 ring-amber-400 ring-inset"
                />
              )}

              {/* File and rank labels, on the outer edge of the board only. */}
              {showRank && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0.5 left-0.5 text-[9px] leading-none font-semibold',
                    light ? 'text-black/40' : 'text-white/50',
                  )}
                >
                  {rank}
                </span>
              )}
              {showFile && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute right-0.5 bottom-0.5 text-[9px] leading-none font-semibold',
                    light ? 'text-black/40' : 'text-white/50',
                  )}
                >
                  {file}
                </span>
              )}

              {piece && (
                <motion.span
                  key={pieceKey(piece.color, piece.type)}
                  initial={{ scale: 0.55, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                  className={cn(
                    'relative z-10 select-none text-[30px] leading-none',
                    piece.color === 'w'
                      ? 'text-[#faf6ea] drop-shadow-[0_1px_1px_rgba(0,0,0,0.65)]'
                      : 'text-[#141a15] drop-shadow-[0_1px_0_rgba(255,255,255,0.35)]',
                  )}
                >
                  {CHESS_GLYPHS[piece.type]}
                </motion.span>
              )}

              {isTarget && (
                <motion.span
                  aria-hidden
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                  className={cn(
                    'absolute',
                    capture
                      ? 'inset-0.5 rounded-full ring-4 ring-emerald-900/45'
                      : 'size-1/4 rounded-full bg-emerald-900/45',
                  )}
                />
              )}

              {/* A castle gets a ring around the whole square and a word on
                  it: the king moves two squares, which no other move does. */}
              {isTarget && castles.has(square) && (
                <>
                  <motion.span
                    aria-hidden
                    animate={{ opacity: [0.4, 0.9, 0.4] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                    className="absolute inset-0.5 rounded-md ring-4 ring-amber-500/70"
                  />
                  <span
                    aria-hidden
                    className="absolute inset-x-0 bottom-0.5 text-center"
                  >
                    <span className="rounded bg-amber-500/95 px-1 text-[8px] font-bold tracking-wide text-black uppercase">
                      Castle
                    </span>
                  </span>
                </>
              )}
            </Button>
          )
        })}
      </div>

      {/* Promotion picker — shadcn Dialog, opened by a pawn reaching the rank. */}
      <Dialog
        open={promotion != null}
        onOpenChange={(open) => {
          if (!open) {
            setPromotion(null)
            setSelected(null)
          }
        }}
      >
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Promote your pawn</DialogTitle>
            <DialogDescription>
              Choose the piece it becomes — the game continues the moment you
              pick.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-4 gap-2">
            {PROMOTION_CHOICES.map((type) => (
              <Button
                key={type}
                type="button"
                variant="outline"
                className="h-20 flex-col gap-1"
                onClick={() => confirmPromotion(type)}
              >
                <span className="text-3xl leading-none">
                  {CHESS_GLYPHS[type]}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {CHESS_PIECE_NAMES[type]}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
