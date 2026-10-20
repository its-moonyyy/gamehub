import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
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
    .refine(isValidPhone, 'Enter a valid phone number (9–15 digits)'),
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
        phoneNumber: normalizePhone(values.phoneNumber),
        password: values.password,
      })
      toast.success(`Welcome back, ${user.displayName}!`)
      navigate(from, { replace: true })
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Login failed. Please try again.'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>
            Log in with your phone number to take a seat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(form.formState.errors.phoneNumber)}>
                <FieldLabel htmlFor="phone-number">Phone number</FieldLabel>
                <Input
                  id="phone-number"
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

              <Field data-invalid={Boolean(form.formState.errors.password)}>
                <FieldLabel htmlFor="password">Password</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  aria-invalid={Boolean(form.formState.errors.password)}
                  {...form.register('password')}
                />
                {form.formState.errors.password && (
                  <FieldError errors={[form.formState.errors.password]} />
                )}
              </Field>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2Icon className="animate-spin" />}
                Log in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          New here?&nbsp;
          <Link
            to="/register"
            className="text-foreground underline underline-offset-4"
          >
            Create an account
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
