import {
  LogOutIcon,
  SettingsIcon,
  SpadeIcon,
  UserRoundIcon,
  UsersIcon,
  WalletIcon,
} from 'lucide-react'
import { motion } from 'motion/react'
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
    <header className="sticky top-0 z-50 bg-gradient-to-b from-background via-background/80 to-transparent px-5 pt-3 pb-2 sm:px-8">
      <motion.div
        initial={{ y: -14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 rounded-full border bg-background/70 pr-1.5 pl-2 shadow-lg shadow-black/5 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60 dark:shadow-black/40"
      >
        <Link
          to="/"
          className="flex items-center gap-2 text-base font-semibold tracking-tight"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <SpadeIcon className="size-4" />
          </span>
          {SITE_NAME}
        </Link>

        {user ? (
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="hidden gap-1.5 rounded-full px-2.5 sm:flex"
            >
              <WalletIcon />
              {formatMoney(user.balance)}
            </Badge>
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
                    <span className="text-xs font-normal text-muted-foreground">
                      {user.phoneNumber}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={handleLogout}>
                  <LogOutIcon />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
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
