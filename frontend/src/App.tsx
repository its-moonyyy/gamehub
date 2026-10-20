import { MotionConfig } from 'motion/react'
import { Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { Navbar } from '@/components/navbar'
import { RequireAuth } from '@/components/require-auth'
import { Toaster } from '@/components/ui/sonner'
import { SocialProvider } from '@/lib/social-context'
import { ChessRoomPage } from '@/pages/chess-room'
import { DominoRoomPage } from '@/pages/domino-room'
import { FriendsPage } from '@/pages/friends'
import { GamePage } from '@/pages/game'
import { HomePage } from '@/pages/home'
import { LoginPage } from '@/pages/login'
import { LudoRoomPage } from '@/pages/ludo-room'
import { NotFoundPage } from '@/pages/not-found'
import { ProfilePage } from '@/pages/profile'
import { RegisterPage } from '@/pages/register'
import { SettingsPage } from '@/pages/settings'
import { TableRoomPage } from '@/pages/table-room'
import { UnoRoomPage } from '@/pages/uno-room'

/** The home reel fills the screen edge to edge — no footer under it. */
const FULLSCREEN_ROUTES = new Set(['/'])

function SiteLayout() {
  const { pathname } = useLocation()
  const withFooter = !FULLSCREEN_ROUTES.has(pathname)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Navbar />
      <main className="flex-1">
        <Outlet />
      </main>
      {withFooter && (
        <footer className="border-t py-6 text-center text-xs text-muted-foreground">
          GameHub — play with real people. No bots, ever. Real-money wallet
          coming soon.
        </footer>
      )}
    </div>
  )
}

/** The table room for whichever game the URL names. */
function TableRoomRoute() {
  const { slug = '' } = useParams()
  if (slug === 'ludo') return <LudoRoomPage />
  if (slug === 'dominoes') return <DominoRoomPage />
  if (slug === 'chess') return <ChessRoomPage />
  if (slug === 'uno') return <UnoRoomPage />
  return <TableRoomPage />
}

export function App() {
  return (
    // One config for the whole app: geometry animates, unless the user asks
    // their system for reduced motion — then only opacity and colour move.
    <MotionConfig reducedMotion="user">
      <SocialProvider>
        <Routes>
          <Route element={<SiteLayout />}>
            <Route index element={<HomePage />} />
            <Route path="login" element={<LoginPage />} />
            <Route path="register" element={<RegisterPage />} />

            {/* Your own account, inside the site chrome */}
            <Route element={<RequireAuth />}>
              <Route path="profile" element={<ProfilePage />} />
              <Route path="friends" element={<FriendsPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>

            <Route path="*" element={<NotFoundPage />} />
          </Route>

          {/* Game lobby + table room, require a logged-in user */}
          <Route element={<RequireAuth />}>
            <Route path="play/:slug" element={<GamePage />} />
            <Route
              path="play/:slug/table/:tableId"
              element={<TableRoomRoute />}
            />
          </Route>
        </Routes>

        <Toaster theme="dark" position="top-center" richColors />
      </SocialProvider>
    </MotionConfig>
  )
}
