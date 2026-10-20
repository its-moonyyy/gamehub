import { useCallback, useEffect, useState } from 'react'
import { BotOffIcon, Loader2Icon, PlusIcon, UsersIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CreateTableDialog } from '@/components/create-table-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage, tablesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatBlinds, initials } from '@/lib/format'
import type { Game, TableSummary } from '@/lib/types'

const POLL_INTERVAL_MS = 5000

export function TablesLobby({ game }: { game: Game }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tables, setTables] = useState<TableSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joiningId, setJoiningId] = useState<number | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const fetchTables = useCallback(
    (quiet = false) => {
      tablesApi
        .listByGame(game.slug)
        .then(setTables)
        .catch((err) => {
          if (!quiet) {
            setError(getApiErrorMessage(err, 'Could not load the tables.'))
          }
        })
    },
    [game.slug],
  )

  useEffect(() => {
    fetchTables()
  }, [fetchTables])

  // Light polling so tables created on other devices show up on their own.
  useEffect(() => {
    const interval = window.setInterval(
      () => fetchTables(true),
      POLL_INTERVAL_MS,
    )
    return () => window.clearInterval(interval)
  }, [fetchTables])

  async function handleJoin(table: TableSummary) {
    setJoiningId(table.id)
    try {
      await tablesApi.join(table.id)
      navigate(`/play/${game.slug}/table/${table.id}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not join this table.'))
      fetchTables()
    } finally {
      setJoiningId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <BotOffIcon className="size-4" />
          Open tables — every seat is a real player
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          Create table
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4">
        {error && !tables ? (
          <div className="flex min-h-full items-center justify-center py-6">
            <Card className="w-full max-w-md">
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="text-sm text-muted-foreground">{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null)
                    fetchTables()
                  }}
                >
                  Try again
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : tables === null ? (
          <div className="flex flex-col gap-3 py-3">
            <Skeleton className="h-[76px] rounded-xl" />
            <Skeleton className="h-[76px] rounded-xl" />
          </div>
        ) : tables.length === 0 ? (
          <div className="flex min-h-full items-center justify-center py-6">
            <Card className="w-full max-w-md">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <UsersIcon className="size-8 text-muted-foreground" />
                <div>
                  <p className="font-medium">No open tables yet</p>
                  <p className="text-sm text-muted-foreground">
                    Create the first one — friends on other devices can join
                    it in seconds.
                  </p>
                </div>
                <Button onClick={() => setCreateOpen(true)}>
                  <PlusIcon />
                  Create table
                </Button>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="flex flex-col gap-3 py-3">
            {tables.map((table) => (
              <TableRow
                key={table.id}
                table={table}
                currentUserId={user?.id}
                joining={joiningId === table.id}
                onJoin={() => handleJoin(table)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateTableDialog
        game={game}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(created) =>
          navigate(`/play/${game.slug}/table/${created.id}`)
        }
      />
    </div>
  )
}

interface TableRowProps {
  table: TableSummary
  currentUserId?: number
  joining: boolean
  onJoin: () => void
}

function TableRow({ table, currentUserId, joining, onJoin }: TableRowProps) {
  const full = table.seatedCount >= table.maxSeats
  const seated =
    currentUserId != null && table.seatedUserIds.includes(currentUserId)
  const blinds = formatBlinds(table.smallBlind, table.bigBlind)
  const label = full && !seated ? 'Full' : seated ? 'Open' : 'Join'

  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <Avatar className="size-10">
          <AvatarFallback className="text-xs">
            {initials(table.creatorName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{table.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            by {table.creatorName} · {table.seatedCount}/{table.maxSeats}{' '}
            seated
            {blinds ? ` · blinds ${blinds}` : ''}
            {table.timeControl ? ` · ${table.timeControl}` : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant={seated ? 'outline' : 'default'}
          disabled={(full && !seated) || joining}
          onClick={onJoin}
        >
          {joining && <Loader2Icon className="animate-spin" />}
          {label}
        </Button>
      </CardContent>
    </Card>
  )
}
