import {
  LogOutIcon,
  ShieldIcon,
  SettingsIcon,
  ClubIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
import LiquidGlass from 'liquid-glass-react'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useAuth } from '@/lib/auth-context'
import { formatMoney, initials } from '@/lib/format'
import { useSocial } from '@/lib/social-context'

const SITE_NAME = 'GameHub'

export function Navbar() {
  const { user, logout } = useAuth()
  const { pendingCount } = useSocial()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    toast('Logged out. See you at the table!')
    navigate('/')
  }
  return (
    <header className="club-site-header sticky top-0 z-50">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="glass-navbar club-navbar mx-auto flex items-center justify-between gap-3"
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full" aria-hidden="true">
          <LiquidGlass
            className="nav-glass-lens"
            style={{ position: 'absolute', top: '50%', left: '50%', width: '100%', height: '100%' }}
            padding="0px"
            cornerRadius={999}
            displacementScale={24}
            blurAmount={0.12}
            saturation={145}
            aberrationIntensity={0.5}
            elasticity={0}
          >
            <span className="block h-14 w-full" />
          </LiquidGlass>
        </div>
        <Link
          to="/"
          className="club-wordmark relative z-10 flex items-center gap-2"
        >
          <span className="club-brand-symbol flex items-center justify-center">
            <ClubIcon className="size-5" />
          </span>
          {SITE_NAME}
        </Link>

        <nav className="club-nav-links relative z-10" aria-label="Main navigation">
          <Button variant="ghost" asChild><Link to="/">The games</Link></Button>
          <Button variant="ghost" asChild><Link to="/friends">Your friends</Link></Button>
        </nav>

        {user ? (
          <div className="relative z-10 flex items-center gap-2">
            {user.role === 'player' && (
              <Badge
                variant="secondary"
                className="gap-1.5 rounded-full px-2.5 tabular-nums"
              >
                <WalletIcon />
                {formatMoney(user.balance)}
              </Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="relative h-9 gap-2 rounded-full px-2"
                >
                  <Avatar className="size-6">
                    <AvatarFallback className="text-[10px]">
                      {initials(user.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
                    {user.displayName}
                  </span>
                  {pendingCount > 0 && (
                    <span
                      aria-hidden
                      className="absolute top-0 right-0 size-2.5 rounded-full bg-primary ring-2 ring-background"
                    />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col gap-0.5">
                    <span>{user.displayName}</span>
                    {user.role === 'player' && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {user.phoneNumber}
                      </span>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {user.role === 'admin' ? (
                  <DropdownMenuItem asChild>
                    <Link to="/admin">
                      <ShieldIcon />
                      Admin dashboard
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/profile">
                        <UserRoundIcon />
                        Profile
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/friends">
                        <UsersIcon />
                        Friends
                        {pendingCount > 0 && (
                          <Badge className="ml-auto h-5 min-w-5 rounded-full px-1.5 text-[10px]">
                            {pendingCount}
                          </Badge>
                        )}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/settings">
                        <SettingsIcon />
                        Settings
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="relative z-10 flex items-center gap-1.5">
            <Button variant="ghost" size="sm" className="rounded-full" asChild>
              <Link to="/login">Log in</Link>
            </Button>
            <Button size="sm" className="rounded-full" asChild>
              <Link to="/register">Sign up</Link>
            </Button>
          </div>
        )}
      </motion.div>
    </header>
  )
}
