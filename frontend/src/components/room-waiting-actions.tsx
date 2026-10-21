import { LinkIcon, UserPlusIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

export function RoomWaitingActions({ onInvite }: { onInvite: () => void }) {
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Table link copied')
    } catch {
      toast.error('Could not copy the link. Share the address from your browser.')
    }
  }

  return (
    <motion.div
      className="grid grid-cols-2 gap-2"
      aria-label="Find players"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <Button size="lg" className="min-w-0 px-2 text-xs sm:text-sm" onClick={onInvite}>
        <UserPlusIcon /> Invite friends
      </Button>
      <Button size="lg" className="min-w-0 px-2 text-xs sm:text-sm" variant="outline" onClick={() => void copyLink()}>
        <LinkIcon /> Copy link
      </Button>
    </motion.div>
  )
}
