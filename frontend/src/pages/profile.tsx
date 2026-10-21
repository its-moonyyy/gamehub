import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArmchairIcon,
  LayoutGridIcon,
  PencilIcon,
  WalletIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage, usersApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatMoney, initials } from '@/lib/format'
import { FALLBACK_GAME_ICON, GAME_ICONS } from '@/lib/game-icons'
import type { GameResult, SeatedTableSummary, UserStats } from '@/lib/types'

/** The stats endpoint sends game slugs; the catalog keys icons per game. */
const GAME_ICON_BY_SLUG: Record<string, LucideIcon> = {
  poker: GAME_ICONS.spade,
  ludo: GAME_ICONS.dice,
  dominoes: GAME_ICONS.domino,
  chess: GAME_ICONS.chess,
  uno: GAME_ICONS.layers,
}

const GAME_NAMES: Record<string, string> = {
  poker: 'Poker', ludo: 'Ludo', dominoes: 'Dominoes', chess: 'Chess', uno: 'Uno',
}

/** "October 2026" — when the account was opened. */
function formatJoined(createdAt: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(createdAt))
}

function StatTile({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon
  label: string
  children: ReactNode
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <div className="truncate text-lg font-medium">{children}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium">{value}</span>
    </div>
  )
}

function SeatedTableRow({ table }: { table: SeatedTableSummary }) {
  const Icon = GAME_ICON_BY_SLUG[table.gameSlug] ?? FALLBACK_GAME_ICON

  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{table.name}</p>
        <p className="text-xs text-muted-foreground">
          {table.gameName} · {table.seatedCount} of {table.maxSeats} seats taken
        </p>
      </div>
      <Button size="sm" variant="outline" asChild>
        <Link to={`/play/${table.gameSlug}/table/${table.id}`}>Rejoin</Link>
      </Button>
    </div>
  )
}

function ResultRow({ result }: { result: GameResult }) {
  const Icon = GAME_ICON_BY_SLUG[result.gameSlug] ?? FALLBACK_GAME_ICON
  return (
    <Card size="sm">
      <CardContent className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {GAME_NAMES[result.gameSlug] ?? result.gameSlug} · {result.tableName}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            vs {result.opponentNames.join(', ')} · {result.summary} · {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(result.finishedAt))}
          </p>
        </div>
        <Badge variant={result.outcome === 'won' ? 'default' : 'secondary'}>
          {result.outcome === 'won' ? 'Won' : result.outcome === 'draw' ? 'Draw' : 'Lost'}
        </Badge>
      </CardContent>
    </Card>
  )
}

export function ProfilePage() {
  const { user } = useAuth()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    usersApi
      .me()
      .then((profile) => {
        if (!cancelled) setStats(profile.stats)
      })
      .catch((err) => {
        if (!cancelled) {
          setError(getApiErrorMessage(err, 'Could not load your profile.'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  function handleRetry() {
    setError(null)
    setStats(null)
    setReloadKey((key) => key + 1)
  }

  // RequireAuth already guarantees a signed-in user.
  if (!user) return null

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-8">
      <Card>
        <CardContent className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-16">
            <AvatarFallback className="text-lg">
              {initials(user.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {user.displayName}
              </h1>
              <Badge variant="secondary">Player #{user.id}</Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              {user.phoneNumber} · joined {formatJoined(user.createdAt)}
            </p>
          </div>
          <Button asChild>
            <Link to="/settings">
              <PencilIcon />
              Edit profile
            </Link>
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={handleRetry}>
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={WalletIcon} label="Play-money balance">
          {formatMoney(user.balance)}
        </StatTile>
        <StatTile icon={LayoutGridIcon} label="Tables opened">
          {stats ? (
            stats.tablesCreated
          ) : (
            <Skeleton className="h-6 w-8" />
          )}
        </StatTile>
        <StatTile icon={ArmchairIcon} label="Seats held right now">
          {stats ? (
            stats.seatedTables.length
          ) : (
            <Skeleton className="h-6 w-8" />
          )}
        </StatTile>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Your tables</CardTitle>
          <CardDescription>
            Where you are sitting right now — hop back in any time.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {stats === null ? (
            <>
              <Skeleton className="h-[68px] rounded-xl" />
              <Skeleton className="h-[68px] rounded-xl" />
            </>
          ) : stats.seatedTables.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <ArmchairIcon className="size-7 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                You are not sitting at a table right now.
              </p>
            </div>
          ) : (
            stats.seatedTables.map((table) => (
              <SeatedTableRow key={table.id} table={table} />
            ))
          )}
        </CardContent>
        <CardFooter className="justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            Every seat is a real player — no bots, ever.
          </span>
          <Button variant="outline" size="sm" asChild>
            <Link to="/">Find a table</Link>
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Game history</CardTitle>
          <CardDescription>Your last 20 completed hands, rounds and games.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {stats === null ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : stats.recentResults.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">Finish a game to see your results here.</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {stats.gameStats.map((item) => (
                  <Card key={item.gameSlug} size="sm">
                    <CardContent>
                      <p className="text-sm font-medium">{GAME_NAMES[item.gameSlug] ?? item.gameSlug}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {item.played} played · {item.won} won · {item.drawn} drawn
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                {stats.recentResults.map((result) => <ResultRow key={result.id} result={result} />)}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>What you sign in with.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <DetailRow label="Display name" value={user.displayName} />
          <Separator />
          <DetailRow label="Phone number" value={user.phoneNumber} />
          <Separator />
          <DetailRow label="Password" value="••••••••" />
          <Separator />
          <DetailRow label="Member since" value={formatJoined(user.createdAt)} />
        </CardContent>
        <CardFooter>
          <Button variant="outline" asChild>
            <Link to="/settings">Manage in settings</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
