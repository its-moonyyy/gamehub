import {
  BlocksIcon,
  ChessKnightIcon,
  DicesIcon,
  LayersIcon,
  LayoutGridIcon,
  SpadeIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/** Maps a game's `icon` key from the API to a Lucide icon. */
export const GAME_ICONS: Record<string, LucideIcon> = {
  spade: SpadeIcon,
  dice: DicesIcon,
  domino: BlocksIcon,
  chess: ChessKnightIcon,
  layers: LayersIcon,
}

/** Used when a game sends an icon key the frontend doesn't know yet. */
export const FALLBACK_GAME_ICON: LucideIcon = LayoutGridIcon
