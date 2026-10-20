import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
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

function createTableSchema(maxSeats: number) {
  return z
    .object({
      name: z
        .string()
        .min(2, 'Table name must be at least 2 characters')
        .max(40, 'Table name must be at most 40 characters'),
      maxSeats: z.coerce
        .number()
        .int()
        .min(2, 'At least 2 seats')
        .max(maxSeats, `At most ${maxSeats} seats`),
      timeControl: z.string(),
      smallBlind: z.coerce.number().min(0).max(1_000_000),
      bigBlind: z.coerce.number().min(0).max(1_000_000),
    })
    .refine((values) => values.bigBlind >= values.smallBlind, {
      message: 'Big blind must be at least the small blind',
      path: ['bigBlind'],
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
  const { user } = useAuth()
  const [submitting, setSubmitting] = useState(false)
  const hasBlinds = game.slug === 'poker'
  const isChess = game.slug === 'chess'

  const schema = useMemo(() => createTableSchema(game.maxSeats), [game.maxSeats])
  type CreateTableValues = z.infer<typeof schema>

  const firstValues = useMemo<CreateTableValues>(() => {
    // Settings-page defaults prefill the dialog; the game still caps the seats.
    const defaults = getTableDefaults()
    return {
      name: `${user?.displayName ?? 'My'} table`,
      maxSeats: Math.max(
        2,
        Math.min(defaults.maxSeats ?? game.maxSeats, game.maxSeats),
      ),
      timeControl: DEFAULT_CHESS_TIME_CONTROL,
      smallBlind: defaults.smallBlind ?? 1,
      bigBlind: defaults.bigBlind ?? 2,
    }
  }, [game.maxSeats, user?.displayName])

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
        name: values.name.trim(),
        maxSeats: values.maxSeats,
        ...(hasBlinds
          ? {
              smallBlind: Math.round(values.smallBlind * 100),
              bigBlind: Math.round(values.bigBlind * 100),
            }
          : {}),
        ...(isChess ? { timeControl: values.timeControl } : {}),
      })
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a table</DialogTitle>
          <DialogDescription>
            Open your own {game.name} table. Every seat goes to a real player —
            no bots.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <FieldGroup>
            <Field data-invalid={Boolean(errors.name)}>
              <FieldLabel htmlFor="table-name">Table name</FieldLabel>
              <Input
                id="table-name"
                maxLength={40}
                aria-invalid={Boolean(errors.name)}
                {...form.register('name')}
              />
              {errors.name && <FieldError errors={[errors.name]} />}
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
                <FieldLabel htmlFor="time-control">Clock</FieldLabel>
                <div
                  id="time-control"
                  role="radiogroup"
                  aria-label="Clock"
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
                {submitting && <Loader2Icon className="animate-spin" />}
                Create &amp; take a seat
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
