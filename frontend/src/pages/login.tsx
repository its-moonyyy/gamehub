import { zodResolver } from '@hookform/resolvers/zod'
import { ClubIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { getApiErrorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth-context'
import { isValidPhone, normalizePhone } from '@/lib/format'

const loginSchema = z.object({
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .refine(
      (value) => value.trim() === 'openAdmin' || isValidPhone(value),
      'Enter a valid phone number',
    ),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { phoneNumber: '', password: '' },
  })

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  async function onSubmit(values: LoginValues) {
    setSubmitting(true)
    try {
      const user = await login({
        phoneNumber:
          values.phoneNumber.trim() === 'openAdmin'
            ? 'openAdmin'
            : normalizePhone(values.phoneNumber),
        password: values.password,
      })
      toast.success(`Welcome back, ${user.displayName}!`)
      navigate(user.role === 'admin' ? '/admin' : from, { replace: true })
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Login failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="site-page-container flex min-h-[calc(100dvh-var(--nav-offset)-5rem)] items-stretch justify-center pb-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="flex w-full"
      >
        <Card className="grid min-h-[34rem] w-full flex-1 grid-cols-1 overflow-hidden rounded-3xl border-border/70 bg-card p-0 shadow-xl shadow-foreground/5 md:grid-cols-[0.82fr_1.18fr]">
          <aside className="relative hidden flex-col justify-between overflow-hidden bg-emerald-950 p-9 text-emerald-50 md:flex lg:p-12">
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-40">
              <div className="absolute -right-24 -top-20 size-80 rounded-full border border-emerald-300/30" />
              <div className="absolute -right-10 -top-6 size-52 rounded-full border border-emerald-300/25" />
              <div className="absolute -bottom-24 -left-20 size-72 rounded-full border border-emerald-300/20" />
            </div>
            <div className="relative flex size-12 items-center justify-center rounded-2xl border border-emerald-200/20 bg-emerald-100/10">
              <ClubIcon className="size-6" />
            </div>
            <div className="relative max-w-sm">
              <SparklesIcon className="mb-5 size-5 text-emerald-300" />
              <p className="text-sm font-medium text-emerald-200">Your seat is waiting</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-tight lg:text-4xl">
                Good games start with good company.
              </h2>
              <p className="mt-4 max-w-xs text-sm leading-6 text-emerald-100/70">
                Sign in to meet your friends and get back to the table.
              </p>
            </div>
            <p className="relative text-xs text-emerald-100/55">GameHub · Play together</p>
          </aside>

          <div className="flex min-w-0 flex-col justify-center px-6 py-10 sm:px-10 lg:px-14">
            <CardHeader className="px-0 pb-8">
              <div className="mb-5 flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-800 md:hidden">
                <ClubIcon className="size-5" />
              </div>
              <CardTitle className="text-3xl tracking-tight">Welcome back</CardTitle>
              <CardDescription className="mt-2 text-base">
                Log in with your phone number to take a seat.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
                <FieldGroup className="gap-5">
                  <Field data-invalid={Boolean(form.formState.errors.phoneNumber)}>
                    <FieldLabel htmlFor="phone-number">Phone number</FieldLabel>
                    <Input
                      id="phone-number"
                      type="tel"
                      autoComplete="username"
                      placeholder="+491701234567"
                      aria-invalid={Boolean(form.formState.errors.phoneNumber)}
                      className="h-12 rounded-xl bg-background px-4"
                      {...form.register('phoneNumber')}
                    />
                    {form.formState.errors.phoneNumber && (
                      <FieldError errors={[form.formState.errors.phoneNumber]} />
                    )}
                  </Field>

                  <Field data-invalid={Boolean(form.formState.errors.password)}>
                    <FieldLabel htmlFor="password">Password</FieldLabel>
                    <Input
                      id="password"
                      type="password"
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      aria-invalid={Boolean(form.formState.errors.password)}
                      className="h-12 rounded-xl bg-background px-4"
                      {...form.register('password')}
                    />
                    {form.formState.errors.password && (
                      <FieldError errors={[form.formState.errors.password]} />
                    )}
                  </Field>

                  <Button type="submit" className="mt-2 h-12 w-full rounded-xl text-base" disabled={submitting}>
                    {submitting && <Loader2Icon className="animate-spin" />}
                    Log in
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
            <CardFooter className="mt-7 justify-center px-0 text-sm text-muted-foreground">
              New here?&nbsp;
              <Link
                to="/register"
                className="font-medium text-foreground underline decoration-emerald-600/50 underline-offset-4 hover:decoration-emerald-600 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
              >
                Create an account
              </Link>
            </CardFooter>
          </div>
        </Card>
      </motion.div>
    </div>
  )
}
