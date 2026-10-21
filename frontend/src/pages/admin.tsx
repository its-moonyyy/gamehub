import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, Loader2Icon, SearchIcon, ShieldIcon, WalletIcon } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, getApiErrorMessage } from '@/lib/api'
import { formatMoney, isValidPhone } from '@/lib/format'
import type { AdminCreditInfo, AdminUserInfo } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

function amountToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null
  const cents = Math.round(Number(value) * 100)
  return Number.isSafeInteger(cents) && cents >= 1 && cents <= 100_000_000
    ? cents
    : null
}

export function AdminPage() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserInfo[] | null>(null)
  const [selected, setSelected] = useState<AdminUserInfo | null>(null)
  const [credits, setCredits] = useState<AdminCreditInfo[] | null>(null)
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [pendingCents, setPendingCents] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [creditsError, setCreditsError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isValidPhone(query)) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      adminApi
        .users(query)
        .then((result) => {
          if (!cancelled) {
            setUsers(result)
            setLoadError('')
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setUsers([])
            setLoadError(getApiErrorMessage(error, 'Unable to load players.'))
          }
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, reloadKey])

  const loadCredits = useCallback(() => {
    adminApi.credits().then((result) => {
      setCredits(result)
      setCreditsError('')
    }).catch((error: unknown) => {
      setCreditsError(getApiErrorMessage(error, 'Unable to load recent credits.'))
    })
  }, [])

  useEffect(() => {
    loadCredits()
  }, [loadCredits])

  function prepareCredit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = amountToCents(amount)
    if (cents === null) {
      setAmountError('Enter an amount from $0.01 to $1,000,000.00, with up to two decimals.')
      return
    }
    if (!selected) return
    setAmountError('')
    setPendingCents(cents)
  }

  async function confirmCredit() {
    if (!selected || pendingCents === null) return
    setSubmitting(true)
    try {
      const result = await adminApi.credit(selected.id, pendingCents)
      const updated = { ...selected, balance: result.balance }
      setSelected(updated)
      setUsers((current) => current?.map((user) => user.id === updated.id ? updated : user) ?? null)
      setCredits((current) => [result, ...(current ?? [])].slice(0, 20))
      setCreditsError('')
      setPendingCents(null)
      setAmount('')
      toast.success(`${formatMoney(result.amountCents)} added to ${result.displayName}.`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to add credits. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <Badge variant="secondary" className="gap-1.5">
          <ShieldIcon className="size-3.5" /> Admin only
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Manage virtual credits</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Find a player by their phone number, review their balance, and add credits.
        </p>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Players</CardTitle>
            <CardDescription>Enter the player's full phone number to find their account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="admin-player-search">Player phone number</FieldLabel>
              <div className="relative">
                <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="admin-player-search"
                  type="tel"
                  autoComplete="tel"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setSelected(null); setPendingCents(null); setUsers(null); setLoadError('') }}
                  placeholder="+491701234567"
                  className="pl-9"
                />
              </div>
            </Field>
            {loadError ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">{loadError}</p>
                <Button variant="outline" size="sm" onClick={() => setReloadKey((key) => key + 1)}>Try again</Button>
              </div>
            ) : !isValidPhone(query) ? (
              <p className="text-sm text-muted-foreground">Enter a full phone number to find a player.</p>
            ) : users === null ? (
              <div className="space-y-2">
                <Skeleton className="h-14 rounded-xl" />
                <Skeleton className="h-14 rounded-xl" />
              </div>
            ) : users.length === 0 ? (
              <p className="text-sm text-muted-foreground">No player found with this phone number.</p>
            ) : (
              <div className="space-y-2" aria-label="Players">
                {users.map((user) => (
                  <Button
                    key={user.id}
                    type="button"
                    variant={selected?.id === user.id ? 'secondary' : 'outline'}
                    onClick={() => setSelected(user)}
                    className="h-auto w-full justify-between gap-3 rounded-xl px-4 py-3 text-start"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{user.displayName}</span>
                      <span className="block text-xs text-muted-foreground">{user.phoneNumber}</span>
                    </span>
                    <span className="shrink-0 tabular-nums">{formatMoney(user.balance)}</span>
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><WalletIcon className="size-4" /> Add credits</CardTitle>
              <CardDescription>Only admin credits create new funds.</CardDescription>
            </CardHeader>
            <CardContent>
              {selected ? (
                <form onSubmit={prepareCredit} className="space-y-4">
                  <div className="rounded-xl bg-muted/50 p-3">
                    <p className="font-medium">{selected.displayName} <span className="text-xs font-normal text-muted-foreground">{selected.phoneNumber}</span></p>
                    <p className="text-sm text-muted-foreground">Current balance: <span className="tabular-nums text-foreground">{formatMoney(selected.balance)}</span></p>
                  </div>
                  <Field data-invalid={Boolean(amountError)}>
                    <FieldLabel htmlFor="credit-amount">Amount ($)</FieldLabel>
                    <Input
                      id="credit-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => { setAmount(event.target.value); setAmountError('') }}
                      placeholder="25.00"
                      aria-invalid={Boolean(amountError)}
                      aria-describedby={amountError ? 'credit-amount-error' : undefined}
                    />
                    {amountError && <p id="credit-amount-error" className="text-sm text-destructive">{amountError}</p>}
                  </Field>
                  <Button type="submit" className="w-full">Review credit</Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">Select a player to add credits.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent credits</CardTitle>
              <CardDescription>The latest admin balance increases.</CardDescription>
            </CardHeader>
            <CardContent>
              {creditsError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">{creditsError}</p>
                  <Button variant="outline" size="sm" onClick={loadCredits}>Try again</Button>
                </div>
              ) : credits === null ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : credits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No credits added yet.</p>
              ) : (
                <ul className="space-y-3">
                  {credits.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{entry.displayName} <span className="font-normal text-muted-foreground">{entry.phoneNumber}</span></span>
                        <span className="text-xs text-muted-foreground">{new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">+{formatMoney(entry.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={pendingCents !== null} onOpenChange={(open) => { if (!open && !submitting) setPendingCents(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm credit</DialogTitle>
            <DialogDescription>
              Add {formatMoney(pendingCents ?? 0)} to {selected?.displayName} ({selected?.phoneNumber})?
              This action is recorded and cannot be reversed on this page.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingCents(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void confirmCredit()} disabled={submitting}>
              {submitting ? <Loader2Icon className="animate-spin" /> : <CheckIcon />}
              Add credits
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
