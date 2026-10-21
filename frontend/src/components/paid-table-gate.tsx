import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Loader2Icon } from 'lucide-react'
import { motion } from 'motion/react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getApiErrorMessage, tablesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { formatMoney } from '@/lib/format'
import type { TableDetails } from '@/lib/types'

/** Shared links ask for payment before any game room takes a new seat. */
export function PaidTableGate({ children }: { children: ReactNode }) {
  const { slug = '', tableId = '' } = useParams()
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const [table, setTable] = useState<TableDetails | null>(null)
  const [allowedTableId, setAllowedTableId] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    let cancelled = false
    tablesApi.get(tableId).then((details) => {
      if (cancelled) return
      if (details.gameSlug !== slug) {
        navigate(`/play/${details.gameSlug}/table/${details.id}`, { replace: true })
        return
      }
      setTable(details)
      if (details.entryFee == null || details.seats.some((seat) => seat.userId === user?.id)) {
        setAllowedTableId(tableId)
      }
    }).catch((error: unknown) => {
      if (cancelled) return
      toast.error(getApiErrorMessage(error, 'Could not open this table.'))
      navigate(`/play/${slug}`, { replace: true })
    })
    return () => { cancelled = true }
  }, [tableId, slug, user?.id, navigate])

  async function confirmEntry() {
    if (!table || table.entryFee == null) return
    setJoining(true)
    try {
      await tablesApi.join(table.id, table.entryFee)
      void refreshUser().catch(() => {})
      setAllowedTableId(tableId)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not enter this table.'))
    } finally {
      setJoining(false)
    }
  }

  if (allowedTableId === tableId) return children

  return (
    <div className="flex h-dvh items-center justify-center p-4">
      {table?.id === Number(tableId) ? (
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Confirm table entry</CardTitle>
            <CardDescription>{table.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Entry price: <span className="font-semibold tabular-nums">{formatMoney(table.entryFee ?? 0)}</span></p>
            <p className="text-muted-foreground">
              {table.gameSlug === 'poker'
                ? 'This is your starting stack. Your remaining chips return to your wallet when you leave.'
                : 'This price is charged once for this seat.'}
            </p>
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <Button variant="outline" disabled={joining} onClick={() => navigate(`/play/${slug}`, { replace: true })}>Cancel</Button>
            <Button disabled={joining} onClick={() => void confirmEntry()}>
              {joining && <motion.span className="inline-flex" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2Icon /></motion.span>}
              Pay &amp; enter
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Skeleton className="h-48 w-full max-w-md rounded-xl" />
      )}
    </div>
  )
}
