import { Loader2Icon } from 'lucide-react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'

/**
 * Route wrapper for pages that require a logged-in user.
 * Redirects to /login and remembers where the user wanted to go.
 */
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (user.role === 'admin') {
    return <Navigate to="/admin" replace />
  }

  return <Outlet />
}
