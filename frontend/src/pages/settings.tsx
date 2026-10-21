import { zodResolver } from '@hookform/resolvers/zod'
import {
  KeyRoundIcon,
  Loader2Icon,
  LogOutIcon,
  SlidersHorizontalIcon,
  UserRoundIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { authApi, getApiErrorMessage, usersApi } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { isValidPhone, normalizePhone } from '@/lib/format'
import { getTableDefaults, saveTableDefaults } from '@/lib/preferences'
import type { TableDefaults } from '@/lib/preferences'

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: ReactNode
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function SubmitButton({
  saving,
  children,
}: {
  saving: boolean
  children: ReactNode
}) {
  return (
    <Button type="submit" className="self-end" disabled={saving}>
      {saving && <Loader2Icon className="animate-spin" />}
      {children}
    </Button>
  )
}

const profileSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(60, 'Name must be at most 60 characters'),
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .refine(
      isValidPhone,
      'Enter a valid phone number (9–15 digits)',
    ),
})

type ProfileValues = z.infer<typeof profileSchema>

function ProfileSection({
  displayName,
  phoneNumber,
  onSaved,
}: {
  displayName: string
  phoneNumber: string
  onSaved: () => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { displayName, phoneNumber },
  })

  async function onSubmit(values: ProfileValues) {
    const nextName = values.displayName.trim()
    const nextPhone = normalizePhone(values.phoneNumber)
    if (nextName === displayName && nextPhone === phoneNumber) {
      toast('Nothing changed.')
      return
    }

    setSaving(true)
    try {
      await usersApi.update({ displayName: nextName, phoneNumber: nextPhone })
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not save your profile.'))
      return
    } finally {
      setSaving(false)
    }

    // Saved; a failed refresh would only leave the navbar briefly stale.
    try {
      await onSaved()
    } catch {
      // Ignored on purpose.
    }
    toast.success('Profile updated — this is your name at every table.')
  }

  return (
    <SectionCard
      icon={UserRoundIcon}
      title="Profile"
      description="The name and number other players see. Your number is how you log in."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.displayName)}>
            <FieldLabel htmlFor="settings-display-name">Display name</FieldLabel>
            <Input
              id="settings-display-name"
              autoComplete="nickname"
              placeholder="How other players see you"
              aria-invalid={Boolean(form.formState.errors.displayName)}
              {...form.register('displayName')}
            />
            {form.formState.errors.displayName && (
              <FieldError errors={[form.formState.errors.displayName]} />
            )}
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.phoneNumber)}>
            <FieldLabel htmlFor="settings-phone-number">
              Phone number
            </FieldLabel>
            <Input
              id="settings-phone-number"
              type="tel"
              autoComplete="tel"
              placeholder="+491701234567"
              aria-invalid={Boolean(form.formState.errors.phoneNumber)}
              {...form.register('phoneNumber')}
            />
            {form.formState.errors.phoneNumber && (
              <FieldError errors={[form.formState.errors.phoneNumber]} />
            )}
          </Field>

          <SubmitButton saving={saving}>Save profile</SubmitButton>
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(72, 'Password must be at most 72 characters'),
    confirmPassword: z.string().min(1, 'Repeat the new password'),
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: 'Choose a password you have not used here',
    path: ['newPassword'],
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'The two passwords do not match',
    path: ['confirmPassword'],
  })

type PasswordValues = z.infer<typeof passwordSchema>

function PasswordSection() {
  const [saving, setSaving] = useState(false)
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  })

  async function onSubmit(values: PasswordValues) {
    setSaving(true)
    try {
      await authApi.changePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      })
      form.reset()
      toast.success('Password changed. You stay signed in on this device.')
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Could not change your password.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard
      icon={KeyRoundIcon}
      title="Password"
      description="Changing it signs nobody out — tokens last until they expire."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.currentPassword)}>
            <FieldLabel htmlFor="settings-current-password">
              Current password
            </FieldLabel>
            <Input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(form.formState.errors.currentPassword)}
              {...form.register('currentPassword')}
            />
            {form.formState.errors.currentPassword && (
              <FieldError errors={[form.formState.errors.currentPassword]} />
            )}
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.newPassword)}>
            <FieldLabel htmlFor="settings-new-password">
              New password
            </FieldLabel>
            <Input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-invalid={Boolean(form.formState.errors.newPassword)}
              {...form.register('newPassword')}
            />
            {form.formState.errors.newPassword && (
              <FieldError errors={[form.formState.errors.newPassword]} />
            )}
          </Field>

          <Field data-invalid={Boolean(form.formState.errors.confirmPassword)}>
            <FieldLabel htmlFor="settings-confirm-password">
              Repeat new password
            </FieldLabel>
            <Input
              id="settings-confirm-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(form.formState.errors.confirmPassword)}
              {...form.register('confirmPassword')}
            />
            {form.formState.errors.confirmPassword && (
              <FieldError errors={[form.formState.errors.confirmPassword]} />
            )}
          </Field>

          <SubmitButton saving={saving}>Change password</SubmitButton>
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

const SEATS_PATTERN = /^\d+$/
const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/

const tableDefaultsSchema = z
  .object({
    maxSeats: z.string().trim(),
    smallBlind: z.string().trim(),
    bigBlind: z.string().trim(),
  })
  .superRefine((values, ctx) => {
    if (
      values.maxSeats !== '' &&
      (!SEATS_PATTERN.test(values.maxSeats) ||
        Number(values.maxSeats) < 2 ||
        Number(values.maxSeats) > 8)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['maxSeats'],
        message: 'Choose 2 to 8 seats',
      })
    }

    for (const field of ['smallBlind', 'bigBlind'] as const) {
      if (values[field] !== '' && !AMOUNT_PATTERN.test(values[field])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'Use an amount like 1 or 0.50',
        })
      }
    }

    if (
      values.smallBlind !== '' &&
      values.bigBlind !== '' &&
      Number(values.bigBlind) < Number(values.smallBlind)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bigBlind'],
        message: 'Big blind must be at least the small blind',
      })
    }
  })

type TableDefaultsValues = z.infer<typeof tableDefaultsSchema>

function TableDefaultsSection() {
  const stored = useMemo(() => getTableDefaults(), [])
  const form = useForm<TableDefaultsValues>({
    resolver: zodResolver(tableDefaultsSchema),
    defaultValues: {
      maxSeats: stored.maxSeats === undefined ? '' : String(stored.maxSeats),
      smallBlind:
        stored.smallBlind === undefined ? '' : String(stored.smallBlind),
      bigBlind: stored.bigBlind === undefined ? '' : String(stored.bigBlind),
    },
  })

  function onSubmit(values: TableDefaultsValues) {
    const defaults: TableDefaults = {}
    if (values.maxSeats !== '') defaults.maxSeats = Number(values.maxSeats)
    if (values.smallBlind !== '') {
      defaults.smallBlind = Number(values.smallBlind)
    }
    if (values.bigBlind !== '') defaults.bigBlind = Number(values.bigBlind)

    saveTableDefaults(defaults)
    toast.success(
      Object.keys(defaults).length > 0
        ? 'Table defaults saved for this browser.'
        : 'Table defaults cleared.',
    )
  }

  function handleClear() {
    form.reset({ maxSeats: '', smallBlind: '', bigBlind: '' })
    saveTableDefaults({})
    toast('Table defaults cleared for this browser.')
  }

  return (
    <SectionCard
      icon={SlidersHorizontalIcon}
      title="Table defaults"
      description="Prefill the create-table dialog on this device. Blinds apply to poker, seats to every game."
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <Field data-invalid={Boolean(form.formState.errors.maxSeats)}>
            <FieldLabel htmlFor="settings-default-seats">Seats</FieldLabel>
            <Input
              id="settings-default-seats"
              inputMode="numeric"
              placeholder="e.g. 6"
              aria-invalid={Boolean(form.formState.errors.maxSeats)}
              {...form.register('maxSeats')}
            />
            {form.formState.errors.maxSeats ? (
              <FieldError errors={[form.formState.errors.maxSeats]} />
            ) : (
              <FieldDescription>2–8 seats; each game caps it.</FieldDescription>
            )}
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field data-invalid={Boolean(form.formState.errors.smallBlind)}>
              <FieldLabel htmlFor="settings-small-blind">
                Small blind
              </FieldLabel>
              <Input
                id="settings-small-blind"
                inputMode="decimal"
                placeholder="1"
                aria-invalid={Boolean(form.formState.errors.smallBlind)}
                {...form.register('smallBlind')}
              />
              {form.formState.errors.smallBlind ? (
                <FieldError errors={[form.formState.errors.smallBlind]} />
              ) : (
                <FieldDescription>In dollars.</FieldDescription>
              )}
            </Field>

            <Field data-invalid={Boolean(form.formState.errors.bigBlind)}>
              <FieldLabel htmlFor="settings-big-blind">Big blind</FieldLabel>
              <Input
                id="settings-big-blind"
                inputMode="decimal"
                placeholder="2"
                aria-invalid={Boolean(form.formState.errors.bigBlind)}
                {...form.register('bigBlind')}
              />
              {form.formState.errors.bigBlind ? (
                <FieldError errors={[form.formState.errors.bigBlind]} />
              ) : (
                <FieldDescription>In dollars.</FieldDescription>
              )}
            </Field>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClear}>
              Clear
            </Button>
            <Button type="submit">Save defaults</Button>
          </div>
        </FieldGroup>
      </form>
    </SectionCard>
  )
}

export function SettingsPage() {
  const { user, logout, refreshUser } = useAuth()

  // RequireAuth already guarantees a signed-in user.
  if (!user) return null

  function handleLogout() {
    // Signing out of a page that needs the session: RequireAuth walks the
    // player to the login form, which remembers where they were and brings
    // them back here after the next login.
    logout()
    toast('Logged out. See you at the table!')
  }

  return (
    <div className="site-page-container space-y-4 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your profile, password and table defaults.
        </p>
      </header>

      <ProfileSection
        displayName={user.displayName}
        phoneNumber={user.phoneNumber}
        onSaved={refreshUser}
      />

      <PasswordSection />

      <TableDefaultsSection />

      <SectionCard
        icon={LogOutIcon}
        title="Session"
        description={
          <>
            Signed in as <span className="font-medium">{user.phoneNumber}</span>{' '}
            on this device.
          </>
        }
      >
        <Button variant="outline" onClick={handleLogout}>
          <LogOutIcon />
          Log out
        </Button>
      </SectionCard>
    </div>
  )
}
