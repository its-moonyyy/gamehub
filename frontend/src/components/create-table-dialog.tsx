import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { getApiErrorMessage, tablesApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import {
  CHESS_TIME_CONTROLS,
  DEFAULT_CHESS_TIME_CONTROL,
  chessTimeControl,
} from '@/lib/chess'
import { getTableDefaults } from '@/lib/preferences'
import type { Game, TableDetails } from '@/lib/types'

function createTableSchema(maxSeats: number, isPoker: boolean) {
  return z
    .object({
      maxSeats: z.coerce
        .number()
        .int()
        .min(2, 'At least 2 seats')
        .max(maxSeats, `At most ${maxSeats} seats`),
      entryFee: z.coerce.number()
        .min(0.01, 'At least $0.01')
        .max(1_000_000, 'At most $1,000,000')
        .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'Use at most two decimals'),
      timeControl: z.string(),
      turnSeconds: z.coerce
        .number()
        .int('Use whole seconds')
        .min(10, 'At least 10 seconds')
        .max(300, 'At most 300 seconds'),
      smallBlind: z.coerce.number().min(0).max(1_000_000),
      bigBlind: z.coerce.number().min(0).max(1_000_000),
    })
    .refine((values) => values.bigBlind >= values.smallBlind, {
      message: 'Big blind must be at least the small blind',
      path: ['bigBlind'],
    })
    .refine((values) => !isPoker || values.entryFee >= values.bigBlind, {
      message: 'The starting stack must cover the big blind',
      path: ['entryFee'],
    })
}

interface CreateTableDialogProps {
  game: Game
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (table: TableDetails) => void
}

export function CreateTableDialog({
  game,
  open,
  onOpenChange,
  onCreated,
}: CreateTableDialogProps) {
  const { refreshUser } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const hasBlinds = game.slug === 'poker'
  const isChess = game.slug === 'chess'

  const schema = useMemo(() => createTableSchema(game.maxSeats, hasBlinds), [game.maxSeats, hasBlinds])
  type CreateTableValues = z.infer<typeof schema>

  const firstValues = useMemo<CreateTableValues>(() => {
    // Settings-page defaults prefill the dialog; the game still caps the seats.
    const defaults = getTableDefaults()
    return {
      maxSeats: Math.max(
        2,
        Math.min(defaults.maxSeats ?? game.maxSeats, game.maxSeats),
      ),
      entryFee: hasBlinds ? (defaults.bigBlind ?? 2) * 100 : 1,
      timeControl: DEFAULT_CHESS_TIME_CONTROL,
      turnSeconds: game.slug === 'poker' ? 60 : 45,
      smallBlind: defaults.smallBlind ?? 1,
      bigBlind: defaults.bigBlind ?? 2,
    }
  }, [game.maxSeats, game.slug, hasBlinds])

  const form = useForm<CreateTableValues>({
    resolver: zodResolver(schema),
    defaultValues: firstValues,
  })

  // Re-read them each time the dialog opens, so a settings change applies
  // without reloading the page.
  useEffect(() => {
    if (open) form.reset(firstValues)
  }, [open, form, firstValues])

  async function onSubmit(values: CreateTableValues) {
    setSubmitting(true)
    try {
      const created = await tablesApi.create(game.slug, {
        entryFee: Math.round(values.entryFee * 100),
        maxSeats: values.maxSeats,
        ...(hasBlinds
          ? {
              smallBlind: Math.round(values.smallBlind * 100),
              bigBlind: Math.round(values.bigBlind * 100),
            }
          : {}),
        ...(isChess
          ? { timeControl: values.timeControl }
          : { turnSeconds: values.turnSeconds }),
      })
      void refreshUser().catch(() => {})
      toast.success(`Table "${created.name}" created — you have seat 1.`)
      onOpenChange(false)
      onCreated(created)
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not create the table.'))
    } finally {
      setSubmitting(false)
    }
  }

  const { errors } = form.formState
  const timeControlId = useWatch({ control: form.control, name: 'timeControl' })
  const selectedControl = chessTimeControl(timeControlId ?? DEFAULT_CHESS_TIME_CONTROL)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="club-create-dialog max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a table</DialogTitle>
          <DialogDescription>
            Your {game.name} table. Real players, your rules.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.entryFee)}>
              <FieldLabel htmlFor="entry-fee">
                {hasBlinds ? 'Starting stack / entry price ($)' : 'Entry price ($)'}
              </FieldLabel>
              <Input
                id="entry-fee"
                type="number"
                inputMode="decimal"
                min={0.01}
                max={1_000_000}
                step={0.01}
                aria-invalid={Boolean(errors.entryFee)}
                {...form.register('entryFee')}
              />
              <p className="text-xs text-muted-foreground">
                {hasBlinds
                  ? 'Charged when you take a seat. Your remaining chips return to your wallet when you leave.'
                  : 'Charged once when you take a seat, including the creator.'}
              </p>
              {errors.entryFee && <FieldError errors={[errors.entryFee]} />}
            </Field>
            {hasBlinds && (
              <div className="grid grid-cols-2 gap-3">
                <Field data-invalid={Boolean(errors.smallBlind)}>
                  <FieldLabel htmlFor="small-blind">Small blind ($)</FieldLabel>
                  <Input
                    id="small-blind"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-invalid={Boolean(errors.smallBlind)}
                    {...form.register('smallBlind')}
                  />
                  {errors.smallBlind && (
                    <FieldError errors={[errors.smallBlind]} />
                  )}
                </Field>
                <Field data-invalid={Boolean(errors.bigBlind)}>
                  <FieldLabel htmlFor="big-blind">Big blind ($)</FieldLabel>
                  <Input
                    id="big-blind"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.5}
                    aria-invalid={Boolean(errors.bigBlind)}
                    {...form.register('bigBlind')}
                  />
                  {errors.bigBlind && <FieldError errors={[errors.bigBlind]} />}
                </Field>
              </div>
            )}

            {isChess && (
              <Field>
                <FieldLabel htmlFor="time-control">Time per player</FieldLabel>
                <div
                  id="time-control"
                  role="radiogroup"
                  aria-label="Time per player"
                  className="grid grid-cols-4 gap-2"
                >
                  {CHESS_TIME_CONTROLS.map((control) => {
                    const selected = timeControlId === control.id
                    return (
                      <Button
                        key={control.id}
                        type="button"
                        size="sm"
                        variant={selected ? 'default' : 'outline'}
                        role="radio"
                        aria-checked={selected}
                        onClick={() =>
                          form.setValue('timeControl', control.id, {
                            shouldDirty: true,
                          })
                        }
                      >
                        {control.id}
                      </Button>
                    )
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedControl.name} — {selectedControl.blurb}.
                </p>
              </Field>
            )}

            {!isChess && (
              <Field data-invalid={Boolean(errors.turnSeconds)}>
                <FieldLabel htmlFor="turn-seconds">
                  Time per player turn (seconds)
                </FieldLabel>
                <Input
                  id="turn-seconds"
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={300}
                  step={1}
                  aria-invalid={Boolean(errors.turnSeconds)}
                  {...form.register('turnSeconds')}
                />
                <p className="text-xs text-muted-foreground">
                  The timer restarts on each turn.
                </p>
                {errors.turnSeconds && <FieldError errors={[errors.turnSeconds]} />}
              </Field>
            )}

            <Field data-invalid={Boolean(errors.maxSeats)}>
              <FieldLabel htmlFor="max-seats">Seats</FieldLabel>
              <Input
                id="max-seats"
                type="number"
                inputMode="numeric"
                min={2}
                max={game.maxSeats}
                aria-invalid={Boolean(errors.maxSeats)}
                {...form.register('maxSeats')}
              />
              {errors.maxSeats && <FieldError errors={[errors.maxSeats]} />}
            </Field>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <motion.span className="inline-flex" animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}><Loader2Icon /></motion.span>}
                Create &amp; pay entry
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
