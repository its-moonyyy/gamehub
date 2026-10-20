import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { authApi, getToken, setToken } from './api'
import type { LoginInput, RegisterInput } from './api'
import type { User } from './types'

interface AuthContextValue {
  user: User | null
  /** True while the stored token is being checked against the API. */
  loading: boolean
  login: (input: LoginInput) => Promise<User>
  register: (input: RegisterInput) => Promise<User>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(() => Boolean(getToken()))

  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    authApi
      .me()
      .then((profile) => {
        if (!cancelled) setUser(profile)
      })
      .catch(() => {
        // Interceptor already cleared an invalid token.
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (input: LoginInput) => {
    const { accessToken, user: profile } = await authApi.login(input)
    setToken(accessToken)
    setUser(profile)
    return profile
  }, [])

  const register = useCallback(async (input: RegisterInput) => {
    const { accessToken, user: profile } = await authApi.register(input)
    setToken(accessToken)
    setUser(profile)
    return profile
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
  }, [])

  const refreshUser = useCallback(async () => {
    const profile = await authApi.me()
    setUser(profile)
  }, [])

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refreshUser }),
    [user, loading, login, register, logout, refreshUser],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
