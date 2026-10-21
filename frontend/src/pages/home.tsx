import { useCallback, useEffect, useState } from 'react'
import { BotOffIcon } from 'lucide-react'
import { ClubHome } from '@/components/club-home'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { gamesApi, getApiErrorMessage } from '@/lib/api'
import type { Game } from '@/lib/types'

/** The club invitation and live game catalog share one viewport. */
export function HomePage() {
  const [games, setGames] = useState<Game[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchGames = useCallback(() => {
    gamesApi
      .list()
      .then(setGames)
      .catch((err) =>
        setError(getApiErrorMessage(err, 'Could not load the games.')),
      )
  }, [])

  useEffect(() => {
    fetchGames()
  }, [fetchGames])

  function handleRetry() {
    setGames(null)
    setError(null)
    fetchGames()
  }

  if (error) {
    return (
      <ReelShell>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={handleRetry}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </ReelShell>
    )
  }

  if (games === null) {
    return (
      <ReelShell>
        <div className="flex w-full max-w-xl flex-col items-center gap-8">
          <Skeleton className="aspect-video w-full max-w-xl rounded-xl" />
          <div className="flex w-full flex-wrap justify-center gap-2">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-14 min-w-[190px] flex-1 rounded-lg" />
            ))}
          </div>
        </div>
      </ReelShell>
    )
  }

  if (games.length === 0) {
    return (
      <ReelShell>
        <Card className="w-full max-w-md">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No games in the catalog yet. More tables are being added all the
            time.
          </CardContent>
        </Card>
      </ReelShell>
    )
  }

  return <ClubHome games={games} />
}

/** Page frame for the loading / error / empty states. */
function ReelShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-[calc(100dvh-var(--nav-offset))] flex-col">
      <div className="site-page-container shrink-0 pt-6 sm:pt-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Games
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a game and join a table of real players.
        </p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        {children}
      </div>
      <p className="flex shrink-0 items-center justify-center gap-1.5 border-t py-3 text-xs text-muted-foreground">
        <BotOffIcon className="size-3.5" />
        Real players only · no bots
      </p>
    </div>
  )
}
