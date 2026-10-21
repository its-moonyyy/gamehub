import { WalletIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth-context'
import { formatMoney } from '@/lib/format'

/** The same virtual balance follows a player through every game. */
export function PlayerWalletBadge() {
  const { user } = useAuth()
  if (!user || user.role !== 'player') return null
  const fullBalance = formatMoney(user.balance)
  const compactBalance = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(user.balance / 100)
  return (
    <Badge variant="secondary" className="shrink-0 gap-1 tabular-nums" aria-label={`Balance ${fullBalance}`} title={`Virtual balance: ${fullBalance}`}>
      <WalletIcon aria-hidden className="size-3.5" />
      {compactBalance}
    </Badge>
  )
}
