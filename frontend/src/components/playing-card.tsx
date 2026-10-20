import { SpadeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const RANK_LABELS: Record<string, string> = { T: '10' }

const SUIT_GLYPHS: Record<string, string> = {
  s: '♠',
  h: '♥',
  d: '♦',
  c: '♣',
}

/**
 * A face-down playing card used on the poker table.
 * Sized by the parent (e.g. `w-9 aspect-[36/49]`).
 */
export function CardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'card-back flex items-center justify-center rounded-md border border-white/15 shadow-sm',
        className,
      )}
    >
      <SpadeIcon className="size-[45%] text-white/30" />
    </div>
  )
}

/**
 * A face-up card. Cards arrive as rank+suit codes, e.g. "As", "Td", "2c".
 * The face scales its own type with the card's width (`@container` + `cqw`),
 * so the same card works on the board (`w-9`) and at the small size used in
 * the seats. It carries its own 36/49 shape; call sites only set a width
 * (or fill a sized parent with `size-full` for the board).
 *
 * The cqw sizes are anchored to the board card: at 36px wide the rank, suit
 * and gap come out at the original 13px / 11px / 3px.
 */
export function PlayingCard({
  card,
  className,
}: {
  card: string
  className?: string
}) {
  const rank = card.slice(0, -1)
  const suit = card.slice(-1)
  const red = suit === 'h' || suit === 'd'
  return (
    <div
      className={cn(
        // `min-h-0`: as a flex item, the automatic minimum height would
        // otherwise let the two lines of type grow the card past its aspect
        // ratio. `leading-none` keeps the inherited line-height from padding
        // those lines at small sizes.
        '@container flex aspect-[36/49] min-h-0 flex-col items-center justify-center rounded-md border border-black/10 bg-white leading-none shadow-sm',
        red ? 'text-red-600' : 'text-zinc-900',
        className,
      )}
    >
      <span className="block text-[38cqw] font-bold">
        {RANK_LABELS[rank] ?? rank}
      </span>
      {/* The spacing rides on the suit as a margin: cqw units only resolve for
          descendants of the container, so a gap on the card itself would fall
          back to the viewport and push the type outside the card. */}
      <span className="mt-[9cqw] block text-[32cqw]">
        {SUIT_GLYPHS[suit] ?? '·'}
      </span>
    </div>
  )
}
