import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckIcon, KeyRoundIcon, Loader2Icon, SearchIcon, ShieldIcon, WalletIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { toast } from 'sonner'
import { adminApi, getApiErrorMessage } from '@/lib/api'
import { formatMoney, isValidPhone } from '@/lib/format'
import type { AdminAdjustmentInfo, AdminUserInfo } from '@/lib/types'
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

function BusyIcon() {
  const reducedMotion = useReducedMotion()
  return (
    <motion.span
      aria-hidden="true"
      className="inline-flex"
      animate={reducedMotion ? undefined : { rotate: 360 }}
      transition={reducedMotion ? undefined : { duration: 1, ease: 'linear', repeat: Infinity }}
    >
      <Loader2Icon className="size-4" />
    </motion.span>
  )
}

export function AdminPage() {
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AdminUserInfo[] | null>(null)
  const [selected, setSelected] = useState<AdminUserInfo | null>(null)
  const [adjustments, setAdjustments] = useState<AdminAdjustmentInfo[] | null>(null)
  const [adjustmentType, setAdjustmentType] = useState<'credit' | 'withdraw'>('credit')
  const [amount, setAmount] = useState('')
  const [amountError, setAmountError] = useState('')
  const [pendingAdjustment, setPendingAdjustment] = useState<{ type: 'credit' | 'withdraw'; cents: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordErrorField, setPasswordErrorField] = useState<'new' | 'confirm' | null>(null)
  const [pendingReset, setPendingReset] = useState(false)
  const [resetSubmitting, setResetSubmitting] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [adjustmentsError, setAdjustmentsError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const amountInput = useRef<HTMLInputElement>(null)
  const passwordInput = useRef<HTMLInputElement>(null)
  const confirmPasswordInput = useRef<HTMLInputElement>(null)

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

  const loadAdjustments = useCallback(() => {
    adminApi.adjustments().then((result) => {
      setAdjustments(result)
      setAdjustmentsError('')
    }).catch((error: unknown) => {
      setAdjustmentsError(getApiErrorMessage(error, 'Unable to load recent balance changes.'))
    })
  }, [])

  useEffect(() => {
    loadAdjustments()
  }, [loadAdjustments])

  function clearActionForms() {
    setPendingAdjustment(null)
    setPendingReset(false)
    setAmount('')
    setAmountError('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordErrorField(null)
  }

  function changeSearch(value: string) {
    setQuery(value)
    setSelected(null)
    setUsers(null)
    setLoadError('')
    clearActionForms()
  }

  function selectUser(user: AdminUserInfo) {
    setSelected(user)
    clearActionForms()
  }

  function cancelReset() {
    setPendingReset(false)
    setNewPassword('')
    setConfirmPassword('')
  }

  function prepareAdjustment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cents = amountToCents(amount)
    if (cents === null) {
      setAmountError('Enter an amount from $0.01 to $1,000,000.00, with up to two decimals.')
      amountInput.current?.focus()
      return
    }
    if (!selected) return
    if (adjustmentType === 'withdraw' && cents > selected.balance) {
      setAmountError('Enter an amount no greater than the current balance.')
      amountInput.current?.focus()
      return
    }
    setAmountError('')
    setPendingAdjustment({ type: adjustmentType, cents })
  }

  async function confirmAdjustment() {
    if (!selected || !pendingAdjustment) return
    setSubmitting(true)
    try {
      const result = pendingAdjustment.type === 'credit'
        ? await adminApi.credit(selected.id, pendingAdjustment.cents)
        : await adminApi.withdraw(selected.id, pendingAdjustment.cents)
      const updated = { ...selected, balance: result.balance }
      setSelected(updated)
      setUsers((current) => current?.map((user) => user.id === updated.id ? updated : user) ?? null)
      setAdjustments((current) => [result, ...(current ?? [])].slice(0, 20))
      setAdjustmentsError('')
      setPendingAdjustment(null)
      setAmount('')
      toast.success(pendingAdjustment.type === 'credit'
        ? `${formatMoney(result.amountCents)} added to ${result.displayName}.`
        : `${formatMoney(-result.amountCents)} withdrawn from ${result.displayName}.`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to change the balance. Try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  function prepareReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    if (newPassword.length < 8 || newPassword.length > 72) {
      setPasswordError('Choose a password between 8 and 72 characters.')
      setPasswordErrorField('new')
      passwordInput.current?.focus()
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('The two passwords do not match.')
      setPasswordErrorField('confirm')
      confirmPasswordInput.current?.focus()
      return
    }
    setPasswordError('')
    setPasswordErrorField(null)
    setPendingReset(true)
  }

  async function confirmReset() {
    if (!selected || !pendingReset) return
    setResetSubmitting(true)
    try {
      await adminApi.resetPassword(selected.id, newPassword)
      setPendingReset(false)
      setNewPassword('')
      setConfirmPassword('')
      toast.success(`Password reset for ${selected.displayName}. Previous sessions no longer have access.`)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Unable to reset the password. Try again.'))
    } finally {
      setResetSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-2">
        <Badge variant="secondary" className="gap-1.5">
          <ShieldIcon className="size-3.5" /> Admin only
        </Badge>
        <h1 className="text-2xl font-semibold tracking-tight">Manage player accounts</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Find a player by phone number to adjust virtual credits or reset their password.
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
                  onChange={(event) => changeSearch(event.target.value)}
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
                    onClick={() => selectUser(user)}
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
              <CardTitle className="flex items-center gap-2"><WalletIcon className="size-4" /> Adjust balance</CardTitle>
              <CardDescription>Add or withdraw virtual credits. Every change is recorded.</CardDescription>
            </CardHeader>
            <CardContent>
              {selected ? (
                <form onSubmit={prepareAdjustment} className="space-y-4" noValidate>
                  <div className="rounded-xl bg-muted/50 p-3">
                    <p className="font-medium">{selected.displayName} <span className="text-xs font-normal text-muted-foreground">{selected.phoneNumber}</span></p>
                    <p className="text-sm text-muted-foreground">Current balance: <span className="tabular-nums text-foreground">{formatMoney(selected.balance)}</span></p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button type="button" variant={adjustmentType === 'credit' ? 'default' : 'outline'} aria-pressed={adjustmentType === 'credit'} onClick={() => { setAdjustmentType('credit'); setAmountError('') }}>Add credits</Button>
                    <Button type="button" variant={adjustmentType === 'withdraw' ? 'default' : 'outline'} aria-pressed={adjustmentType === 'withdraw'} onClick={() => { setAdjustmentType('withdraw'); setAmountError('') }}>Withdraw credits</Button>
                  </div>
                  <Field data-invalid={Boolean(amountError)}>
                    <FieldLabel htmlFor="adjustment-amount">Amount ($)</FieldLabel>
                    <Input
                      ref={amountInput}
                      id="adjustment-amount"
                      type="text"
                      inputMode="decimal"
                      value={amount}
                      onChange={(event) => { setAmount(event.target.value); setAmountError('') }}
                      placeholder="25.00"
                      aria-invalid={Boolean(amountError)}
                      aria-describedby={amountError ? 'adjustment-amount-error' : undefined}
                    />
                    {amountError && <p id="adjustment-amount-error" className="text-sm text-destructive">{amountError}</p>}
                  </Field>
                  <Button type="submit" className="w-full">Review {adjustmentType === 'credit' ? 'credit' : 'withdrawal'}</Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">Select a player to adjust their balance.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRoundIcon className="size-4" /> Reset password</CardTitle>
              <CardDescription>Set a new password for the selected player. Their previous sessions will lose access.</CardDescription>
            </CardHeader>
            <CardContent>
              {selected ? (
                <form onSubmit={prepareReset} className="space-y-4" noValidate>
                  <p className="text-sm">{selected.displayName} <span className="text-muted-foreground">{selected.phoneNumber}</span></p>
                  <Field data-invalid={passwordErrorField === 'new'}>
                    <FieldLabel htmlFor="admin-new-password">New password</FieldLabel>
                    <Input
                      ref={passwordInput}
                      id="admin-new-password"
                      type="password"
                      name="newPassword"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => { setNewPassword(event.target.value); setPasswordError(''); setPasswordErrorField(null) }}
                      aria-invalid={passwordErrorField === 'new'}
                      aria-describedby={passwordErrorField === 'new' ? 'admin-password-help admin-password-error' : 'admin-password-help'}
                    />
                    <p id="admin-password-help" className="text-xs text-muted-foreground">Use 8–72 characters. Share the new password with the player privately.</p>
                    {passwordErrorField === 'new' && <p id="admin-password-error" role="alert" className="text-sm text-destructive">{passwordError}</p>}
                  </Field>
                  <Field data-invalid={passwordErrorField === 'confirm'}>
                    <FieldLabel htmlFor="admin-confirm-password">Confirm new password</FieldLabel>
                    <Input
                      ref={confirmPasswordInput}
                      id="admin-confirm-password"
                      type="password"
                      name="confirmPassword"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => { setConfirmPassword(event.target.value); setPasswordError(''); setPasswordErrorField(null) }}
                      aria-invalid={passwordErrorField === 'confirm'}
                      aria-describedby={passwordErrorField === 'confirm' ? 'admin-password-error' : undefined}
                    />
                    {passwordErrorField === 'confirm' && <p id="admin-password-error" role="alert" className="text-sm text-destructive">{passwordError}</p>}
                  </Field>
                  <Button type="submit" variant="outline" className="w-full">Review password reset</Button>
                </form>
              ) : (
                <p className="text-sm text-muted-foreground">Select a player to reset their password.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent balance changes</CardTitle>
              <CardDescription>The latest admin additions and withdrawals.</CardDescription>
            </CardHeader>
            <CardContent>
              {adjustmentsError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">{adjustmentsError}</p>
                  <Button variant="outline" size="sm" onClick={loadAdjustments}>Try again</Button>
                </div>
              ) : adjustments === null ? (
                <Skeleton className="h-16 rounded-xl" />
              ) : adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No balance changes yet.</p>
              ) : (
                <ul className="space-y-3">
                  {adjustments.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{entry.displayName} <span className="font-normal text-muted-foreground">{entry.phoneNumber}</span></span>
                        <span className="text-xs text-muted-foreground">{entry.kind === 'admin_credit' ? 'Added' : 'Withdrawn'} · {new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.createdAt))}</span>
                      </span>
                      <span className="shrink-0 font-medium tabular-nums">{entry.amountCents > 0 ? '+' : '−'}{formatMoney(Math.abs(entry.amountCents))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={pendingAdjustment !== null} onOpenChange={(open) => { if (!open && !submitting) setPendingAdjustment(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {pendingAdjustment?.type === 'withdraw' ? 'withdrawal' : 'credit'}</DialogTitle>
            <DialogDescription>
              {pendingAdjustment?.type === 'withdraw' ? 'Withdraw' : 'Add'} {formatMoney(pendingAdjustment?.cents ?? 0)} {pendingAdjustment?.type === 'withdraw' ? 'from' : 'to'} {selected?.displayName} ({selected?.phoneNumber})?
              The change will be recorded in the wallet history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAdjustment(null)} disabled={submitting}>Cancel</Button>
            <Button onClick={() => void confirmAdjustment()} disabled={submitting}>
              {submitting ? <BusyIcon /> : <CheckIcon />}
              {pendingAdjustment?.type === 'withdraw' ? 'Withdraw credits' : 'Add credits'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingReset} onOpenChange={(open) => { if (!open && !resetSubmitting) cancelReset() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm password reset</DialogTitle>
            <DialogDescription>
              Replace the password for {selected?.displayName} ({selected?.phoneNumber})? Their current password and active sessions will stop working. Share the new password privately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelReset} disabled={resetSubmitting}>Cancel</Button>
            <Button onClick={() => void confirmReset()} disabled={resetSubmitting}>
              {resetSubmitting && <BusyIcon />}
              Reset password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
