# GameHub: Blue Hour Club

## Three directions

| Direction | Thesis | Palette | Type | Imagery and example screen |
| --- | --- | --- | --- | --- |
| Blue Hour Club — selected | The feeling of settling into an evening game with friends. | Ink `#14243E`, glacier `#BED3EF`, peach `#F2BEA0`, chalk `#F4F5F7` | Bricolage Grotesque for identity; Geist for controls | Existing glass ace artwork, atmospheric blue light; featured game with five direct game choices. |
| Sunday Table | A sunny shared table, familiar and playful. | Porcelain `#F3F3E8`, cherry `#C0443E`, cornflower `#527FBC`, butter `#EBCB70` | Rounded bold display; plain sans body | Oversized illustrated game pieces; a loose tabletop composition. |
| Signal Arcade | A crisp, energetic game station. | Silver `#DDE3E8`, electric blue `#2354F4`, black `#141820`, orange `#F57542` | Condensed bold display; monospace metadata | Cropped game symbols; a split game chooser and play panel. |

Static example screens: `artifacts/gamehub-design/concept-*.png`.

## Product job and frequency

Players choose a game, find or create a human table, and play. The home page is an invitation; the lobby and room are frequently used workspaces. Motion responds to game selection and opening controls. No ambient moving decoration.

## Composition and content

- Home: one large invitation, selected game's actual catalog copy, one primary entry action, five direct game choices. No fabricated player totals, testimonials, or activity.
- Lobby: game context at the left, actual tables at the right. Filtering and height-aware pagination keep every action in the viewport without a scrolling table list.
- Poker: a wide table on spacious screens, the existing portrait seat arrangement on phones. All cards, pots, timers, stacks, and actions remain server driven.

## Material and typography

Bricolage Grotesque gives the club a compact, friendly wordmark and large open headlines. Geist handles small labels and tabular money values. Glacier identifies primary actions; peach accents the club identity and selected game. Glass has three weights: light controls, heavier panels, and dense modal surfaces. Game boards and playing cards retain strong opaque contrast.

## Accessibility and verification

Keep shadcn control semantics, visible focus, labels and error states. Honor reduced motion and reduced transparency. Check the home, lobby and poker room on desktop, portrait mobile and short landscape. Verify selection, pagination, entry confirmation, dialogs, actual poker actions and page overflow. Final screenshots use the real local backend with explicitly seeded test players, never simulated activity in production.

## Verified implementation

- Production build passes; Vite reports the existing large main bundle warning.
- Frontend lint passes with six existing warnings in shadcn primitives, auth/social contexts, and the Uno room.
- Headless Chromium inspected at 1440×900, 390×844, 320×568, and 844×390. All three pages report document dimensions equal to the viewport and no offscreen links or controls. See `artifacts/gamehub-design/viewport-check.json`.
- Visually corrected narrow lobby overflow, short landscape home clipping, tiny poker seats on short screens, and the create dialog's offscreen footer.
- Verified all five game selections, reduced-motion selection, table pagination, own-table filtering, entry cancellation, table creation, a real Call action, and server progression to the flop.
- Verified eight-seat compact layout without seat overlap and create actions visible in portrait and landscape.
- Final screenshots use the local Nest/Postgres backend with test accounts. No fabricated activity was added to application code. No production deployment was performed for this redesign.
- Browser coverage: Chromium. Safari/Firefox and physical-device touch testing remain unverified.
