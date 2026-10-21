import { useEffect, useState } from 'react'
import { WifiOffIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { subscribeConnectionStatus, type ConnectionStatus } from '@/lib/game-events'

export function RoomConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  useEffect(() => subscribeConnectionStatus(setStatus), [])
  if (status === 'live' || status === 'connecting') return null
  return (
    <Badge variant="secondary" role="status" className="shrink-0 gap-1 text-[10px]">
      <WifiOffIcon className="size-3" />
      {status === 'offline' ? 'Offline' : 'Reconnecting'}
    </Badge>
  )
}
