import { useCallback, useEffect, useState } from 'react'
import { BotOffIcon, Loader2Icon, PlayIcon, PlusIcon, UsersIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { CreateTableDialog } from '@/components/create-table-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage, tablesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatBlinds, formatMoney, initials } from '@/lib/format'
import type { Game, TableSummary } from '@/lib/types'
import { subscribeGameEvents } from '@/lib/game-events'

const POLL_INTERVAL_MS = 30_000

export function TablesLobby({ game }: { game: Game }) {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [tables, setTables] = useState<TableSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joiningId, setJoiningId] = useState<number | null>(null)
  const [pendingTable, setPendingTable] = useState<TableSummary | null>(null)
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

  // Live invalidation with a slow fallback for missed events.
  useEffect(() => {
    const unsubscribe = subscribeGameEvents((event) => {
      if (event.kind === 'sync' || (event.kind === 'table' && event.gameSlug === game.slug)) fetchTables(true)
    })
    const interval = window.setInterval(
      () => { if (!document.hidden) fetchTables(true) },
      POLL_INTERVAL_MS,
    )
    const onReturn = () => fetchTables(true)
    window.addEventListener('focus', onReturn)
    return () => {
      unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener('focus', onReturn)
    }
  }, [fetchTables, game.slug])

  function handleQuickPlay() {
    if (!tables) return
    const candidates = [...tables]
      .filter((table) => table.seatedCount < table.maxSeats || table.seatedUserIds.includes(user?.id ?? -1))
      .sort((a, b) => {
        const aMine = a.seatedUserIds.includes(user?.id ?? -1) ? 1 : 0
        const bMine = b.seatedUserIds.includes(user?.id ?? -1) ? 1 : 0
        return bMine - aMine || b.seatedCount - a.seatedCount || a.id - b.id
      })
    if (candidates[0]) void handleJoin(candidates[0])
    else setCreateOpen(true)
  }

  async function handleJoin(table: TableSummary) {
    if (!table.seatedUserIds.includes(user?.id ?? -1) && table.entryFee != null) {
      setPendingTable(table)
      return
    }
    await joinTable(table)
  }

  async function joinTable(table: TableSummary) {
    setJoiningId(table.id)
    try {
      await tablesApi.join(table.id, table.entryFee ?? undefined)
      void refreshUser().catch(() => {})
      setPendingTable(null)
      navigate(`/play/${game.slug}/table/${table.id}`)
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not join this table.'))
      fetchTables()
      setPendingTable(null)
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <PlusIcon /> Create table
          </Button>
          <Button size="sm" disabled={!tables} onClick={handleQuickPlay}>
            <PlayIcon />
            Play now
          </Button>
        </div>
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

      <Dialog open={pendingTable !== null} onOpenChange={(open) => { if (!open && joiningId === null) setPendingTable(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm table entry</DialogTitle>
            <DialogDescription>
              Pay {formatMoney(pendingTable?.entryFee ?? 0)} to take a seat at {pendingTable?.name}.
              {game.slug === 'poker'
                ? ' This becomes your starting stack; your remaining chips return to your wallet when you leave.'
                : ' This entry price is charged once for this seat.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={joiningId !== null} onClick={() => setPendingTable(null)}>Cancel</Button>
            <Button disabled={joiningId !== null} onClick={() => { if (pendingTable) void joinTable(pendingTable) }}>
              {joiningId !== null && <motion.span className="inline-flex" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2Icon /></motion.span>}
              Pay &amp; join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
  const label = full && !seated ? 'Full' : seated ? 'Rejoin' : 'Join'

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
            {table.entryFee != null ? ` · entry ${formatMoney(table.entryFee)}` : ''}
            {table.timeControl ? ` · ${table.timeControl} per player` : ''}
            {table.turnSeconds != null ? ` · ${table.turnSeconds}s/turn` : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant={seated ? 'outline' : 'default'}
          disabled={(full && !seated) || joining}
          onClick={onJoin}
        >
          {joining && <motion.span className="inline-flex" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2Icon /></motion.span>}
          {label === 'Join' && table.entryFee != null ? `Join · ${formatMoney(table.entryFee)}` : label}
        </Button>
      </CardContent>
    </Card>
  )
}
