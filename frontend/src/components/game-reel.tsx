import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotOffIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MoveHorizontalIcon,
  PlayIcon,
  XIcon,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { Transition } from 'motion/react'
import { Link } from 'react-router-dom'
import { GameStill } from '@/components/game-still'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
import type { Game } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Geometry settles with weight; light (opacity, blur) follows quickly. */
const REEL_SPRING: Transition = {
  type: 'spring',
  stiffness: 230,
  damping: 30,
  mass: 0.9,
}
const FADE: Transition = { duration: 0.3, ease: 'easeOut' }
/** How far a neighbour turns away from the centre of the reel. */
const SPREAD_DEGREES = 58
/** One wheel notch or drag must beat this before the reel moves a cue. */
const STEP_THRESHOLD = 60
const STEP_LOCK_MS = 380

/** `2–8 players. Classic no-limit Texas Hold’em.` — the cue caption. */
function cueCaption(game: Game) {
  const sentence = game.description.split('. ')[0]?.trim() ?? ''
  const tagline = sentence.endsWith('.') ? sentence : `${sentence}.`
  return `${game.players} players. ${tagline}`
}

/**
 * The home reel: a widescreen coverflow of every game in the catalog, a cue
 * sheet to jump between them, and a letterboxed detail view that opens the
 * still you are looking at. Wheel, drag, arrow keys and the cues all move the
 * same reel; the stills themselves are drawn by `GameStill`.
 */
export function GameReel({ games }: { games: Game[] }) {
  const [requestedActive, setRequestedActive] = useState(0)
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const centreStillRef = useRef<HTMLButtonElement>(null)
  const wheel = useRef({ distance: 0, lockedUntil: 0 })
  const reduced = useReducedMotion()

  // Clamped while rendering: the catalog could shrink under us.
  const active = Math.max(0, Math.min(requestedActive, games.length - 1))

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      setStage({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const step = useCallback(
    (delta: number) => {
      setRequestedActive((current) =>
        Math.min(Math.max(current + delta, 0), Math.max(games.length - 1, 0)),
      )
    },
    [games.length],
  )

  function moveTo(index: number) {
    setRequestedActive(Math.min(Math.max(index, 0), Math.max(games.length - 1, 0)))
  }

  // Arrow keys and Enter/Escape work anywhere on the page, as long as the
  // focus is not in a text field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target?.closest('input, textarea, select, [contenteditable="true"]')
      ) {
        return
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        step(1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        step(-1)
      } else if (event.key === 'Enter' && !open) {
        setOpen(true)
      } else if (event.key === 'Escape' && open) {
        setOpen(false)
      } else {
        return
      }
      event.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [step, open])

  // The reel screen owns the viewport height, so the detail view only ever
  // has to scroll itself — nothing to lock here (home locks the document).
  // Focus is the Dialog's business: Radix moves focus into the surface and
  // hands it back to the still that opened it.

  // The reel is one screen: nothing behind it may scroll, and a wheel nudge
  // over the reel must step the reel only — never move the page (that is what
  // used to make the whole thing vibrate). React attaches `onWheel` passively,
  // so keeping the page still needs a native listener with `passive: false`.
  useEffect(() => {
    const element = stageRef.current
    if (!element) return

    function onWheel(event: WheelEvent) {
      event.preventDefault()
      if (open) return
      const now = Date.now()
      if (now < wheel.current.lockedUntil) return
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY
      wheel.current.distance += delta
      if (Math.abs(wheel.current.distance) < STEP_THRESHOLD) return
      step(wheel.current.distance > 0 ? 1 : -1)
      wheel.current.distance = 0
      wheel.current.lockedUntil = now + STEP_LOCK_MS
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [step, open])

  function handleDragEnd(_event: unknown, info: { offset: { x: number }; velocity: { x: number } }) {
    const power = info.offset.x + info.velocity.x * 0.16
    if (power < -STEP_THRESHOLD) {
      step(1)
    } else if (power > STEP_THRESHOLD) {
      step(-1)
    }
  }

  const stillWidth = Math.min(
    Math.max(
      stage.width * (stage.height > stage.width ? 0.78 : 0.52),
      stage.height * 0.9,
    ),
    stage.width * 0.86,
    stage.height * 1.5,
    760,
  )

  // Free space beside the centre still. The peeling neighbours live in 3D and
  // browsers only hit-test part of a rotated plane, so when there is room the
  // reel also steps from flat controls sitting in that space.
  const sideGap = Math.max(0, (stage.width - stillWidth) / 2)

  const current = games[active]

  if (!current) return null

  return (
    <div className="relative flex h-[calc(100dvh-var(--nav-offset))] flex-col overflow-hidden overscroll-none bg-background">
      {/* Page header */}
      <div className="mx-auto flex w-full max-w-5xl shrink-0 items-start justify-between gap-4 px-4 pt-6 [@media(max-height:620px)]:pt-3 sm:pt-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight [@media(max-height:620px)]:text-xl sm:text-3xl">
            Games
          </h1>
          <p className="mt-1 text-sm text-muted-foreground [@media(max-height:520px)]:hidden">
            Choose a game and join a table of real players.
          </p>
        </div>
        <div className="hidden shrink-0 text-right sm:block">
          <p className="text-sm font-medium">{current.name}</p>
          <AnimatePresence mode="wait" initial={false}>
            <motion.p
              key={current.slug}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={FADE}
              className="mt-0.5 max-w-60 text-xs text-muted-foreground"
            >
              {cueCaption(current)}
            </motion.p>
          </AnimatePresence>
        </div>
        <Badge variant="secondary" className="shrink-0 sm:hidden">
          {active + 1} / {games.length}
        </Badge>
      </div>

      {/* Reel */}
      <div
        ref={stageRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden overscroll-none bg-muted/30"
        data-testid="reel-stage"
      >

        <motion.ul
          drag={reduced ? false : 'x'}
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.16}
          dragSnapToOrigin
          onDragEnd={handleDragEnd}
          style={{ perspective: 1300, transformStyle: 'preserve-3d' }}
          className="relative flex size-full items-center justify-center"
          data-testid="reel"
        >
          {games.map((game, index) => {
            const distance = index - active
            const depth = Math.min(Math.abs(distance), 2)
            const isCentre = distance === 0

            return (
              <motion.li
                key={game.slug}
                className="absolute"
                style={{
                  width: stillWidth,
                  zIndex: 30 - depth,
                  willChange: 'transform, opacity, filter',
                }}
                initial={false}
                animate={{
                  x: distance * stillWidth * (reduced ? 0.62 : 0.74),
                  z: reduced ? 0 : -depth * stillWidth * 0.3,
                  rotateY: reduced ? 0 : distance * -SPREAD_DEGREES,
                  scale: 1 - depth * 0.07,
                  opacity: depth > 1 ? 0 : 1,
                  filter: reduced ? 'blur(0px)' : `blur(${depth * 2.6}px)`,
                }}
                transition={{
                  x: REEL_SPRING,
                  z: REEL_SPRING,
                  rotateY: REEL_SPRING,
                  scale: REEL_SPRING,
                  opacity: FADE,
                  filter: FADE,
                }}
              >
                <Button
                  ref={(element) => {
                    // Keep hold of the centred still so the Dialog can hand
                    // focus back to it when it closes.
                    if (isCentre) centreStillRef.current = element
                  }}
                  type="button"
                  variant="ghost"
                  onClick={() => (isCentre ? setOpen(true) : moveTo(index))}
                  aria-label={
                    isCentre
                      ? `Open ${game.name}`
                      : `Show ${game.name} on the reel`
                  }
                  aria-current={isCentre ? 'true' : undefined}
                  data-testid={`reel-still-${game.slug}`}
                  className={cn(
                    // The shadcn button *is* the tile: it is flattened into a
                    // plain media frame so `GameStill` can paint the whole face.
                    'group relative block aspect-video h-auto w-full overflow-hidden rounded-xl bg-card p-0 shadow-sm ring-1 ring-foreground/10',
                    'outline-none hover:bg-transparent',
                    "[&_svg:not([class*='size-'])]:size-full",
                    'focus-visible:ring-2 focus-visible:ring-ring',
                    isCentre
                      ? ''
                      : 'cursor-pointer opacity-60 hover:opacity-80',
                  )}
                >
                  {/* The still flies into the dialog when it opens; without the
                      shared id it would fight its own copy. */}
                  <motion.div
                    layoutId={
                      open && isCentre ? undefined : `still-${game.slug}`
                    }
                    className="absolute inset-0"
                  >
                    <GameStill slug={game.slug} icon={game.icon} />
                  </motion.div>
                  {isCentre && (
                    <motion.span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 bg-gradient-to-t from-background/95 via-background/70 to-transparent pt-8 pb-2.5 text-xs font-medium text-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <PlayIcon className="size-3.5" />
                      Preview
                    </motion.span>
                  )}
                </Button>
              </motion.li>
            )
          })}
        </motion.ul>

        {sideGap >= 84 && (
          <>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Previous game"
              data-testid="reel-prev"
              onClick={() => step(-1)}
              disabled={active === 0}
              className="absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-full bg-background/90 shadow-sm backdrop-blur focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Next game"
              data-testid="reel-next"
              onClick={() => step(1)}
              disabled={active === games.length - 1}
              className="absolute right-4 top-1/2 z-40 -translate-y-1/2 rounded-full bg-background/90 shadow-sm backdrop-blur focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </>
        )}
      </div>

      {/* Cue sheet */}
      <div className="shrink-0 border-t bg-background pt-3 pb-4 [@media(max-height:620px)]:pt-2 [@media(max-height:620px)]:pb-2">
        <div className="mx-auto w-full max-w-5xl px-4">
          <div
            className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap"
            data-testid="cue-sheet"
          >
          {games.map((game, index) => {
            const isActive = index === active
            const GameIcon = GAME_ICONS[game.icon] ?? FALLBACK_GAME_ICON

            return (
              <Button
                key={game.slug}
                type="button"
                variant="outline"
                onClick={() => moveTo(index)}
                aria-current={isActive ? 'true' : undefined}
                data-testid={`cue-${game.slug}`}
                className={cn(
                  'relative flex h-auto min-w-0 flex-1 items-center justify-start gap-2.5 rounded-lg px-3 py-2 text-left',
                  '[@media(max-height:620px)]:py-1.5 sm:min-w-[190px]',
                  'focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'border-foreground/20 text-foreground hover:bg-transparent'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
              >
                {isActive && (
                  <motion.span
                    aria-hidden
                    layoutId="cue-frame"
                    transition={REEL_SPRING}
                    className="absolute inset-0 rounded-lg bg-muted"
                  />
                )}
                <span
                  className={cn(
                    'relative flex size-8 shrink-0 items-center justify-center rounded-md',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground',
                  )}
                >
                  <GameIcon className="size-4" />
                </span>
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {game.name}
                  </span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {game.players} players
                  </span>
                </span>
              </Button>
            )
          })}
        </div>
        <p className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground [@media(max-height:620px)]:hidden">
          <span className="flex items-center gap-1.5">
            <ArrowLeftIcon className="size-3.5" />
            <ArrowRightIcon className="size-3.5" />
            Arrow keys step the reel
          </span>
          <span className="hidden items-center gap-1.5 sm:flex">
            <MoveHorizontalIcon className="size-3.5" />
            Drag or scroll to browse
          </span>
          <span className="flex items-center gap-1.5">
            <PlayIcon className="size-3.5" />
            Open to preview
          </span>
          <span className="hidden items-center gap-1.5 lg:flex">
            <BotOffIcon className="size-3.5" />
            Real players only · no bots
          </span>
        </p>
        </div>
      </div>

      {/* Detail view: a shadcn Dialog owns the semantics (focus trap, Escape,
          scroll lock, aria) while Motion drives the still that flies in from
          the reel. */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-testid="detail-view"
          aria-modal="true"
          showCloseButton={false}
          onCloseAutoFocus={(event) => {
            // A Dialog only hands focus back to a `DialogTrigger`, and the
            // reel opens this one itself — so return focus to the still.
            event.preventDefault()
            centreStillRef.current?.focus({ preventScroll: true })
          }}
          className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto rounded-xl p-0 sm:max-w-2xl"
        >
          <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-t-xl bg-muted">
            <motion.div
              layoutId={open ? `still-${current.slug}` : undefined}
              className="size-full"
            >
              <GameStill
                slug={current.slug}
                icon={current.icon}
                className="rounded-none border-0"
              />
            </motion.div>
            <DialogClose asChild>
              <Button
                variant="secondary"
                size="icon-sm"
                className="absolute top-2 right-2 shadow-sm"
              >
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogClose>
          </div>

          <div className="flex flex-col gap-4 p-4">
            <DialogHeader>
              <DialogTitle className="text-xl">{current.name}</DialogTitle>
              <DialogDescription>{current.description}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{current.players} players</Badge>
              <Badge
                variant={
                  current.status === 'available' ? 'default' : 'secondary'
                }
              >
                {current.status === 'available' ? 'Live now' : 'Coming soon'}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={`/play/${current.slug}`}>
                  {current.status === 'available'
                    ? 'Take a seat'
                    : 'Preview game'}
                </Link>
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Back to games</Button>
              </DialogClose>
            </div>

            {/* Filmstrip of the other games */}
            <div className="border-t pt-3">
              <p className="mb-2 text-xs text-muted-foreground">More games</p>
              <div className="flex flex-wrap gap-2">
                {games.map((game, index) => (
                  <Button
                    key={game.slug}
                    type="button"
                    variant="ghost"
                    onClick={() => moveTo(index)}
                    aria-label={`Show ${game.name}`}
                    aria-current={index === active ? 'true' : undefined}
                    data-testid={`filmstrip-${game.slug}`}
                    className={cn(
                      'relative aspect-video h-auto w-24 overflow-hidden rounded-lg border p-0 hover:bg-transparent',
                      "[&_svg:not([class*='size-'])]:size-full",
                      index === active
                        ? 'border-foreground/20 ring-1 ring-foreground/10'
                        : 'border-border opacity-60 hover:opacity-100',
                    )}
                  >
                    <GameStill
                      slug={game.slug}
                      icon={game.icon}
                      className="rounded-none border-0"
                    />
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
