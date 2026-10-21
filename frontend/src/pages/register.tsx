import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router-dom'
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

const registerSchema = z.object({
  displayName: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(60, 'Name must be at most 60 characters'),
  phoneNumber: z
    .string()
    .min(1, 'Phone number is required')
    .refine(isValidPhone, 'Enter a valid phone number (9–15 digits)'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters'),
})

type RegisterValues = z.infer<typeof registerSchema>

export function RegisterPage() {
  const { register: registerUser } = useAuth()
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { displayName: '', phoneNumber: '', password: '' },
  })

  async function onSubmit(values: RegisterValues) {
    setSubmitting(true)
    try {
      const user = await registerUser({
        displayName: values.displayName.trim(),
        phoneNumber: normalizePhone(values.phoneNumber),
        password: values.password,
      })
      toast.success(`Welcome to the table, ${user.displayName}!`)
      navigate('/', { replace: true })
    } catch (error) {
      toast.error(
        getApiErrorMessage(error, 'Sign up failed. Please try again.'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="site-page-container flex justify-center py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
          <CardDescription>
            A phone number and a password is all you need.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <FieldGroup>
              <Field data-invalid={Boolean(form.formState.errors.displayName)}>
                <FieldLabel htmlFor="display-name">Display name</FieldLabel>
                <Input
                  id="display-name"
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
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  aria-invalid={Boolean(form.formState.errors.password)}
                  {...form.register('password')}
                />
                {form.formState.errors.password && (
                  <FieldError errors={[form.formState.errors.password]} />
                )}
              </Field>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting && <Loader2Icon className="animate-spin" />}
                Create account
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm text-muted-foreground">
          Already have an account?&nbsp;
          <Link
            to="/login"
            className="text-foreground underline underline-offset-4"
          >
            Log in
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
