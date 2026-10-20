import {
  cardColor,
  cardCorner,
  cardGlyph,
  cardValue,
  UNO_COLORS,
  UNO_COLOR_DEEP,
  UNO_COLOR_HEX,
} from '@/lib/uno'
import { cn } from '@/lib/utils'

const OVAL_ROTATION = '-rotate-[18deg]'

/**
 * A face-up Uno card. Sized by the parent; the type scales with the card's
 * own width (`@container` + `cqw`), so the same face works in the hand, on
 * the discard pile and in the home reel's still.
 */
export function UnoCardFace({
  card,
  className,
}: {
  card: string
  className?: string
}) {
  const color = cardColor(card)
  const wild = color === 'W'
  const hex = wild ? '#111827' : UNO_COLOR_HEX[color]
  const deep = wild ? '#020617' : UNO_COLOR_DEEP[color]
  const corner = cardCorner(card)
  const glyph = cardGlyph(card)

  return (
    <div
      data-card={card}
      className={cn(
        '@container relative aspect-[5/7] min-h-0 shrink-0 overflow-hidden rounded-[12%] border border-black/45 shadow-md select-none',
        className,
      )}
      style={{ background: `linear-gradient(155deg, ${hex}, ${deep})` }}
    >
      {/* The white oval every Uno card carries. Kept clear of the corners
          so the white corner indices always sit on the card colour. */}
      <span
        className={cn(
          'absolute inset-x-[13%] inset-y-[14%] rounded-[50%] bg-white/95 shadow-[inset_0_0_6px_rgba(0,0,0,0.28)]',
          OVAL_ROTATION,
        )}
      />
      {wild ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <span className={cn('grid grid-cols-2 gap-[3cqw]', OVAL_ROTATION)}>
            {UNO_COLORS.map((entry) => (
              <span
                key={entry}
                className="size-[15cqw] rounded-full border border-black/10"
                style={{ backgroundColor: UNO_COLOR_HEX[entry] }}
              />
            ))}
          </span>
        </span>
      ) : (
        <span className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-[40cqw] leading-none font-black"
            style={{ color: UNO_COLOR_HEX[color] }}
          >
            {glyph}
          </span>
        </span>
      )}
      {cardValue(card) === 'F' && (
        <span className="absolute inset-0 flex items-center justify-center text-[30cqw] leading-none font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
          +4
        </span>
      )}
      <span className="absolute top-[5%] left-[7%] text-[18cqw] leading-none font-black text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
        {corner}
      </span>
      <span className="absolute right-[7%] bottom-[5%] rotate-180 text-[18cqw] leading-none font-black text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]">
        {corner}
      </span>
    </div>
  )
}

/** The face-down card on the draw pile. */
export function UnoCardBack({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        '@container relative aspect-[5/7] min-h-0 shrink-0 overflow-hidden rounded-[12%] border border-black/45 shadow-md select-none',
        className,
      )}
      style={{ background: 'linear-gradient(150deg, #b91c1c, #7f1d1d)' }}
    >
      <span
        className={cn(
          'absolute inset-x-[13%] inset-y-[14%] rounded-[50%] bg-white/95',
          OVAL_ROTATION,
        )}
      />
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center text-[26cqw] leading-none font-black tracking-tight text-red-700 italic',
          OVAL_ROTATION,
        )}
      >
        UNO
      </span>
    </div>
  )
}
