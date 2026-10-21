import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { PlayerWalletBadge } from '@/components/player-wallet-badge'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { TablesLobby } from '@/components/tables-lobby'
import { GameStill } from '@/components/game-still'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { gamesApi, getApiErrorMessage, getApiStatus } from '@/lib/api'
import type { Game } from '@/lib/types'
import { NotFoundPage } from './not-found'

export function GamePage() {
  const { slug = '' } = useParams()
  const [game, setGame] = useState<Game | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchGame = useCallback(() => {
    gamesApi
      .get(slug)
      .then(setGame)
      .catch((err) => {
        if (getApiStatus(err) === 404) {
          setNotFound(true)
        } else {
          setError(getApiErrorMessage(err, 'Could not load this game.'))
        }
      })
  }, [slug])

  useEffect(() => {
    fetchGame()
  }, [fetchGame])

  if (notFound) {
    return <NotFoundPage />
  }

  return (
    <div data-game={game?.slug} className="club-lobby glass-game-shell flex h-[100dvh] flex-col overflow-hidden">
      {/* App bar — always visible, the page itself never scrolls */}
      <div className="glass-game-header club-lobby-topbar flex w-full shrink-0 items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/" aria-label="Back to all games">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          
        </div>
        <PlayerWalletBadge />
      </div>

      <div className="club-lobby-shell">
        {game && (
          <aside className="club-lobby-aside">
            <div className="club-lobby-art"><GameStill slug={game.slug} icon={game.icon} /></div>
            <div className="club-lobby-game-copy">
              <p className="club-invitation">A little friendly competition</p>
              <h1>{game.name}</h1>
              <p>{game.description}</p>
              <div className="club-lobby-facts"><span>{game.players} players</span><span>No bots. Ever.</span></div>
            </div>
            <p className="club-lobby-aside-note">Bring your friends.<br />Make it a regular thing.</p>
          </aside>
        )}
        <div className="club-lobby-workspace">
        {error ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-4">
            <Card className="w-full max-w-md">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null)
                    fetchGame()
                  }}
                >
                  Try again
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : !game ? (
          <div className="flex flex-col gap-3 px-4 py-4">
            <Skeleton className="h-12 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </div>
        ) : game.status === 'available' ? (
          <TablesLobby key={game.slug} game={game} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
            <ComingSoonCard game={game} />
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

function ComingSoonCard({ game }: { game: Game }) {
  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle className="text-lg">{game.name} is on the way</CardTitle>
        <CardDescription>
          Tables will be human-only, just like poker — bring your friends, no
          bots will ever fill a seat.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        We build one game at a time so every table gets real opponents. Poker
        is live now — {game.name} comes next.
      </CardContent>
      <CardFooter className="gap-2">
        <Button
          onClick={() =>
            toast.success(`We'll notify you when ${game.name} goes live!`)
          }
        >
          Notify me
        </Button>
        <Button variant="outline" asChild>
          <Link to="/play/poker">Play poker meanwhile</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}
