import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { TablesLobby } from '@/components/tables-lobby'
import { Badge } from '@/components/ui/badge'
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
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
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

  const Icon = game ? (GAME_ICONS[game.icon] ?? FALLBACK_GAME_ICON) : null

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      {/* App bar — always visible, the page itself never scrolls */}
      <div className="mx-auto flex w-full max-w-3xl shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/" aria-label="Back to all games">
            <ArrowLeftIcon />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
          {game && Icon ? (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" />
              </span>
              <span className="truncate text-base font-semibold">
                {game.name}
              </span>
              <Badge
                variant={game.status === 'available' ? 'default' : 'secondary'}
              >
                {game.status === 'available' ? 'Live' : 'Soon'}
              </Badge>
            </>
          ) : (
            <span className="text-sm text-muted-foreground">Game</span>
          )}
        </div>
        <span aria-hidden className="size-9" />
      </div>

      <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
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
          <TablesLobby game={game} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8">
            <ComingSoonCard game={game} />
          </div>
        )}
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
