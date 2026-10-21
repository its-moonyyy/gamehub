import { useCallback, useEffect, useRef, useState } from 'react'
import type { WheelEvent as ReactWheelEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowUpRightIcon, UsersIcon, HeartHandshakeIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { GameStill } from '@/components/game-still'
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
import type { Game } from '@/lib/types'

export function ClubHome({ games }: { games: Game[] }) {
  const [selected, setSelected] = useState(games[0].slug)
  const selectedIndex = Math.max(0, games.findIndex((item) => item.slug === selected))
  const game = games[selectedIndex] ?? games[0]
  const previousGame = games[(selectedIndex - 1 + games.length) % games.length]
  const nextGame = games[(selectedIndex + 1) % games.length]
  const reducedMotion = useReducedMotion()
  const wheelDistance = useRef(0)

  const changeGame = useCallback((direction: number, focusButton = false) => {
    const currentIndex = Math.max(0, games.findIndex((item) => item.slug === selected))
    const nextIndex = (currentIndex + direction + games.length) % games.length
    const nextGame = games[nextIndex]
    if (!nextGame) return

    setSelected(nextGame.slug)
    if (focusButton) {
      document
        .querySelector<HTMLButtonElement>(`[data-game-choice="${CSS.escape(nextGame.slug)}"]`)
        ?.focus()
    }
  }, [games, selected])

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    const pageCanScroll = document.documentElement.scrollHeight > document.documentElement.clientHeight
    if (pageCanScroll && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) return

    const delta = event.deltaY || event.deltaX
    if (Math.abs(delta) < 8) return
    event.preventDefault()
    wheelDistance.current += delta
    if (Math.abs(wheelDistance.current) < 60) return

    changeGame(wheelDistance.current > 0 ? 1 : -1)
    wheelDistance.current = 0
  }

  useEffect(() => {
    function handleGameKeys(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

      const target = event.target
      if (target instanceof HTMLElement) {
        if (target.isContentEditable || target.closest('input, textarea, select')) return
        if (
          target !== document.body &&
          target !== document.documentElement &&
          !target.closest('.club-game-picker')
        ) return
      }

      event.preventDefault()
      changeGame(event.key === 'ArrowRight' ? 1 : -1, true)
    }

    window.addEventListener('keydown', handleGameKeys)
    return () => window.removeEventListener('keydown', handleGameKeys)
  }, [changeGame])

  return (
    <div className="club-home" onWheel={handleWheel}>
      <section className="club-hero" aria-label="Choose your next game">
        <div className="club-hero-copy">
          <p className="club-invitation"><HeartHandshakeIcon aria-hidden="true" /> Your people. Your table.</p>
          <motion.h1 initial={{ opacity: 0, y: reducedMotion ? 0 : 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
            Good games.<br />Better company.
          </motion.h1>
          <p className="club-hero-intro">A little friendly competition.<br />A reason to stay for one more.</p>
          <div className="club-feature-copy" aria-live="polite" aria-atomic="true">
            <span className="club-game-meta"><UsersIcon aria-hidden="true" /> {game.players} players <span className="club-meta-dot" /> Real people only</span>
            <h2>{game.name}</h2>
            <p>{game.description}</p>
          </div>
          <Button className="club-primary-action" size="lg" asChild>
            <Link to={`/play/${game.slug}`}>
              {game.status === 'available' ? 'Find a table' : 'Explore game'} <ArrowUpRightIcon aria-hidden="true" />
            </Link>
          </Button>
        </div>
        <div className="club-hero-art" aria-hidden="true">
          <div className="club-art-orbit" />
          {previousGame && (
            <div className="club-art-preview club-art-preview-left">
              <GameStill slug={previousGame.slug} icon={previousGame.icon} className={`club-preview-still club-preview-still-${previousGame.slug}`} />
            </div>
          )}
          {nextGame && (
            <div className="club-art-preview club-art-preview-right">
              <GameStill slug={nextGame.slug} icon={nextGame.icon} className={`club-preview-still club-preview-still-${nextGame.slug}`} />
            </div>
          )}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div className="club-art-scene" key={game.slug} initial={{ opacity: 0, x: reducedMotion ? 0 : 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reducedMotion ? 0 : -12 }} transition={{ duration: 0.22 }}>
              <GameStill slug={game.slug} icon={game.icon} className={`club-feature-art club-feature-art-${game.slug}`} />
            </motion.div>
          </AnimatePresence>
          <span className="club-art-caption">The best seat is yours.</span>
        </div>
      </section>
      <nav className="club-game-picker" aria-label="Games">
        {games.map((item) => {
          const Icon = GAME_ICONS[item.icon] ?? FALLBACK_GAME_ICON
          const active = game.slug === item.slug
          return (
            <Button key={item.slug} data-game-choice={item.slug} variant="ghost" className="club-game-choice" aria-pressed={active} onClick={() => setSelected(item.slug)}>
              <span className="club-game-symbol"><Icon aria-hidden="true" /></span>
              <span className="club-game-choice-copy"><strong>{item.slug === 'poker' ? 'Poker' : item.name}</strong><small>{item.players} players</small></span>
              {active && <motion.span className="club-choice-indicator" layoutId="club-game-indicator" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
            </Button>
          )
        })}
      </nav>
      <div className="club-home-footer"><span>{games.length} games. Countless good evenings.</span><span>Virtual credits. Just for play.</span></div>
    </div>
  )
}
