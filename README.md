# GameHub

A fullstack game platform starter — **play online games with real people only, no bots**.

First games: **Texas Hold'em Poker** (table UI built from `wireframe/poker-wireframe.figcraft`), **Ludo**, **Dominoes**, **Chess** and **Uno** — all fully playable on one shared table system.

| Layer    | Tech                                                        | Location            |
| -------- | ----------------------------------------------------------- | ------------------- |
| Frontend | React 19 + TypeScript + Vite + Tailwind 4 + **shadcn/ui** + **Motion** | `frontend/`         |
| Backend  | NestJS 12 + TypeORM (REST API under `/api`) + JWT auth      | `backend/`          |
| Database | PostgreSQL 18 (Docker container, port `5433`)               | `docker-compose.yml` |

## Prerequisites

- Node.js 20+ (tested with 26)
- Docker (for the PostgreSQL container)

## Quickstart

```bash
# 1. Install dependencies (root, backend, frontend)
npm install
npm run install:all

# 2. Start PostgreSQL
npm run db:up

# 3. Start the backend and frontend together
npm run dev
```

- Frontend: <http://localhost:5173>
- API: <http://localhost:3000/api>

Tables (`users`, `games`, `tables`, `table_players`, `tasks`) are created automatically on first start (TypeORM `synchronize: true`, development only) and the game catalog is seeded with Poker + Ludo + Dominoes + Chess + Uno.

### Test from your phone (same Wi-Fi)

```bash
# Terminal 1 — backend
npm run dev:api
# Terminal 2 — frontend on your LAN (prints a Network URL like http://192.168.x.y:5173)
cd frontend && npm run dev -- --host
# allow the port once, if the firewall blocks it (Linux/ufw)
sudo ufw allow from <your-wifi-subnet> to any port 5173 proto tcp
```

Open the printed **Network** URL on the phone and log in. `/api` calls ride the Vite proxy, so only port 5173 needs to be reachable — no backend exposure, no CORS.

**Demo account** (created during setup): phone `+491701234567`, password `secretpass123`.

## Features

- **Accounts** — register/login with **phone number + password** (+ display name). Passwords are hashed with bcrypt, sessions use JWT (Bearer token, 7 days). The API normalises phone numbers the same way on every route, so `+49 170 123-45 67` and `+491701234567` are one account. A stored token the API rejects is dropped at boot: public pages keep working as a visitor, protected pages send you to `/login`.
- **Lobby** — the home page is a **game reel**: a widescreen coverflow of the catalog (each game gets its own still — the poker banner for poker, a drawn board and dice for Ludo, a laid-out chain of dominoes for Dominoes, a tipped chess board with the pieces set for Chess, a fanned hand of cards for Uno), a compact cue sheet, and a detail dialog with the game's copy and a **Take a seat** button. Arrow keys, drag, scroll, the cues or the round edge controls step the reel; the reeled-in game is the one you open. The detail view is a shadcn `Dialog`: Escape, the close button or **Back to games** closes it, and focus lands back on the still you opened. The reel owns the viewport — while home is mounted the document cannot scroll and wheel/touch gestures over the reel step the reel instead, so the page never drifts or bounces under your hands. Games carry a `status` (`available` / `coming_soon`).
- **Tables lobby** (`/play/:slug`, requires login) — selecting a game opens its table list: join an open table or **create your own** (name, blinds for poker, a clock for chess, seat count). Creating a table seats you at it instantly; a table disappears once its last player leaves. Every game runs on this one system: tables, seats, ready-up and rooms all share it. Table links are self-correcting: `/play/poker/table/<ludo id>` lands in the Ludo room for that table, and a link to a table that no longer exists returns to the tables lobby with a toast.
- **Seated, human tables** — every seat is a real account with a name and a **presence dot**: green when the player is online, red once their browser goes quiet, amber while a waiting game is held up by them not being ready. The lobby polls every 5 seconds and the room every ~1 second, so a friend joining from another device appears at your table without a refresh (no WebSocket layer yet). Joining is idempotent — re-entering a table keeps your seat; **Leave table** in the room menu frees it.
- **Poker room** (`/play/poker/table/:tableId`, requires login) — full-screen table that follows the wireframe: turn timer, seats filled with the real humans at the table, dealer button and small/big blind chips on the seats that posted them, pot, blinds, 5 community cards, your hole cards, bet slider (shadcn `Slider`) and fold/check/call/raise/all-in buttons. Every button is driven by the server's legal actions — they're only enabled when it's your turn and the move is legal. The pot sits in the middle of the felt: the **main pot**, with any **side pot** stacked above it, and the result of a hand names the pot each player took.
- **Real poker engine** (no bots, server-authoritative):
  - Hands start when **every seated player presses Ready**; stacks are 100 big blinds (a busted stack is automatically topped up to 100 BB before the next hand).
  - Blinds rotate (heads-up: the button posts the small blind and acts first preflop), 2 hole cards each, burn cards before each street, showdown with hand names, and split pots split to the cent (odd chips go to the first winner clockwise from the button).
  - **Side pots follow the rules**: chips sit in layers, an all-in caps the pot that player can win and everything above it becomes a side pot for the players who stayed in. The room shows the main pot and every side pot, and each pot is settled on its own.
  - **The uncalled part of a bet goes back to the bettor** — a bet nobody could match is not part of the pot, so the pot only ever shows what was really contested. The posted blinds are a matched pair and are never uncalled.
  - **A short all-in does not reopen the betting**: a raise smaller than the last full raise lifts the bet but leaves the minimum raise where it was, and a player who has already acted may only call or fold until a full raise comes in.
  - A blind that is too short still has to be called in full, the minimum raise is the last full raise, and the big blind keeps the option.
  - Each turn has a **60-second timer** shown in the top bar; timing out auto-checks (or folds when facing a bet). The server itself enforces the clock, so hands progress even if a player closes their tab.
  - **The deck never leaves the server** — every response is masked per viewer: you only ever see your own hole cards (and everyone's hands that have been revealed at showdown).
- **Ludo room** (`/play/ludo/table/:tableId`, requires login) — the same table system with a Ludo board on top:
  - 2–4 players own one corner each (heads-up sits opposite). Seats, Ready-up and the 45-second turn timer work exactly like poker.
  - Roll the dice, tap a highlighted token to move it, and the server tells everyone the new position: **the board is only ever drawn from server state**, so two phones can never disagree.
  - Rules: a 6 gets a token out of the base and earns another roll, captures send tokens home (and earn another roll), the eight star squares are safe, three 6s in a row lose the turn, and a token needs the exact roll to come home. First to bring all four tokens home wins.
  - Running out of time doesn't stall the table: the server rolls or moves for the player who timed out. A player leaving mid-race ends it for the survivors.
- **Dominoes room** (`/play/dominoes/table/:tableId`, requires login) — draw dominoes on the same table system:
  - 2–4 players; **7 tiles each**, the rest stays face down in the **boneyard**. The player holding the **highest double** starts (highest tile if no double was dealt) and may open with any tile.
  - The boneyard lies on the table as a **face-down stack of the table's own tiles**, tucked into the corner behind the chain.
  - Your hand sits under the board, standing upright in a **fan of tiles noticeably smaller than the table's own** — overlapped just enough to fit the row when you draw extra, never so much that a tile hides its neighbour's pips. Every playable tile is highlighted: tap a tile that fits one end to play it, or when it fits both, pick **Play left / Play right** — each button names the pip that choice would leave open. Match either open end; nothing fits? In a two- or four-player game **Draw** from the boneyard and try again; once it is empty, **Pass**. In a **three-player game the boneyard is never touched** — a player with no legal tile simply passes, so the seven leftover tiles stay face down.
  - The first player to empty their hand wins. A **blocked round** (everyone passed in a row) goes to the fewest pips left, and a tie on pips splits the win — `resultReason` (`hand`, `blocked` or `forfeit`) and `winnerUserIds` tell the room exactly why.
  - **Opponents' tiles never leave the server**: you only ever see each player's tile count, never which tiles they hold or what they are worth — a pip total is private information and is not even sent to the room.
  - The **45-second turn timer** is enforced by the server: running out of time draws, passes or plays a tile for you, so a phone that goes dark never stalls the table. Leaving mid-round ends it for the survivors (`forfeit`).
- **Chess room** (`/play/chess/table/:tableId`, requires login) — the classic duel, human-only, on the same table system:
  - **Two seats, no bots.** Every game needs both players ready; colours **alternate between games** so nobody is always White (game 1 gives White to seat 1). The creator picks the table's clock when they open it — **1+0, 3+2, 5+0 or 10+5** — and the lobby shows it on the table row.
  - A full 8×8 board drawn from the server's 64-square state, **oriented for your colour** — Black sees the board from the other side, with the file and rank labels on the outer edge. Tap one of your pieces to see its highlighted destinations, tap a destination to play it (captures are marked with a ring).
  - **The server is the only authority on the rules**: legal moves, checks, castling (with rights tracked through the game), en passant, promotion, checkmate, stalemate, threefold repetition, the fifty-move rule, insufficient material, draw offers and the FIDE flag rule are all decided in the engine — the browser only ever sends a move the server already listed as legal.
  - **Castling is marked, not hidden**: when the king may castle, the status line says so (`Your move — castling is available (g1)`) and the castle square is ringed and labelled **Castle** on the board — a king never moves two squares, so it needs saying. The rights follow FIDE 3.8.2: king and rook unmoved, the squares between them empty, and the king may not stand in check, cross an attacked square or land on one. The rook itself may be under attack, and the king may have been in check earlier.
  - **Promotion** opens a shadcn `Dialog` with queen/rook/bishop/knight; if a client sends a promotion without a piece, the server promotes to a queen.
  - **Real chess clocks**: each seat carries its own bank and the side on the move counts down (tenths under twenty seconds, red for low time). The mover's elapsed time is charged and their increment added, so a 3+2 table plays like 3+2. A flag fall ends the game instead of moving for you (unlike Ludo, a chess game is never played for you), and a flag in a dead position is a draw, not a loss.
  - **Captured pieces and material** sit on a rail under the board (White's tray on the left), the **move list** in the room menu shows every move in SAN with the latest highlighted, and last-move squares stay tinted so both players can follow the game.
  - **Offer a draw** from the actions row: the opponent gets an Accept/Decline banner, declining leaves the game running, and agreeing scores `½–½`. **Resign** sits beside it (with a confirmation dialog). A finished game shows the score the way chess writes it (`1–0` / `0–1` / `½–½`) and the button becomes **Ready for a rematch**.
- **Uno room** (`/play/uno/table/:tableId`, requires login) — the card game, human-only, on the same table system:
  - **2–6 players**, each dealt 7 cards from the official 108-card deck. Seats, ready-up and the 45-second turn timer work exactly like the other games.
  - Your hand sits under the felt with every legal card highlighted: tap a card to play it, or **Draw** when nothing fits — the card you drew is the only one you may play then, or **Pass** it on.
  - **Wilds always play and ask for a colour** (a shadcn `Dialog` with the four colours); a **Wild Draw Four** only plays while you hold no card of the active colour. Skip, reverse (a skip in heads-up), Draw Two and Draw Four pass the turn on and make the victim draw, and the felt shows which colour is live, which way the play is going and how many cards are left to draw.
  - **Call UNO** when you are down to one card — or catch someone who did not: the window is 15 seconds, an uncaught one-card hand draws 2 cards as the penalty, and the seat strip shows who is safe (`UNO!`) and who is on the hook.
  - **Hands never leave the server**: you only ever see your own cards plus every player's card count. Running out of time plays a legal card (or draws) for you, so a phone that goes dark never stalls the table; leaving mid-game ends it for the survivors.
- **No bots policy** — open seats say "Open seat" and can only ever be taken by another registered human.
- **Profile** (`/profile`, requires login) — your account at a glance: name, phone, play-money balance, how many tables you opened, and **every seat you hold right now** with a one-tap **Rejoin** that drops you straight back into that table room.
- **Settings** (`/settings`, requires login) — edit your display name or phone number (the phone must not be taken; the name every table shows updates immediately), change your password (the current one is required, and other sessions stay signed in), and save **table defaults** — seats/blinds that prefill the create-table dialog on this device.
- **Friends** (`/friends`, requires login) — find players by display name or phone number and send a request; incoming requests can be accepted or declined and sent ones taken back, all on one page. Friends show the same presence dot the seats use (green while their calls are inside the 30-second window, with a "last seen" line otherwise). The navbar dots your avatar whenever a request or a table invite is waiting, and the friends page is where both are answered.
- **Table invites** — from any room menu, **Invite friends** lists your friends and offers a seat: people already seated or already invited are switched off. Invites are friends-only (the server checks the friendship), one open invite per friend per table, and they disappear with the table. The invited player gets a live toast with a **Join** button plus an entry on their friends page; accepting seats them at the table and drops them straight into the room. Declining (or an invite to a table you already sit at) closes it, and a friend can be invited again later.
- **Wallet foundation** — every user has a `balance` (stored in cents, `$0.00` for now) ready for real-money features later.

## Project structure

```
first_react_nest/
├── docker-compose.yml          # PostgreSQL 18 (port 5433 on the host)
├── wireframe/                  # poker-wireframe.figcraft (source of the poker table layout)
├── package.json                # Root scripts: dev, db:up, db:down, ...
├── backend/                    # NestJS API
│   ├── .env                    # DB connection, PORT, JWT_SECRET
│   └── src/
│       ├── main.ts             # Bootstrap: /api prefix, CORS, validation
│       ├── app.module.ts       # Config + TypeORM (Postgres) wiring
│       ├── auth/               # Register, login, password change, JWT guard, @Public()/@CurrentUser()
│       ├── users/              # User entity + profile service/controller (stats, name/phone edits, presence heartbeat, never exposes passwordHash)
│       ├── games/              # Game entity + seeded catalog (poker, ludo, dominoes, chess, uno)
│       ├── tables/             # Tables + seat membership (list/create/join/leave/action)
│       ├── poker/              # Hold'em engine: deck, hand evaluator, betting state machine (+ unit tests)
│       ├── ludo/               # Ludo engine: dice, movement, captures, home column, timeouts (+ unit tests)
│       ├── dominoes/           # Dominoes engine: deal, chain, boneyard draws, blocked rounds, timeouts (+ unit tests)
│       ├── chess/              # Chess engine: move generation, castling, en passant, promotion, mate/draw rules, FEN (+ unit tests)
│       ├── uno/                # Uno engine: 108-card deck, matching, wild colours, skips/reverses/draws, the UNO call window, timeouts (+ unit tests)
│       └── tasks/              # Original Tasks CRUD example (now behind auth)
└── frontend/                   # React + Vite app
    ├── components.json         # shadcn config (style: radix-nova, neutral, Geist)
    └── src/
        ├── components/ui/      # shadcn components — used as-is, never modified
        ├── components/         # navbar, game-reel (home coverflow), game-still (per-game artwork), tables-lobby, create-table-dialog, poker-seat, player-status-dot, ludo-board, ludo-seat, domino-piece, domino-seat, chess-board, chess-seat, uno-card, uno-seat, ...
        ├── lib/                # api client (axios + token), auth context, types, format, ludo board geometry, chess geometry/glyphs, uno card helpers, browser preferences
        └── pages/              # home (the game reel), login, register, profile, settings, game (tables + coming soon), table-room, ludo-room, domino-room, chess-room, uno-room, not-found
```

## API

Base URL: `http://localhost:3000/api`. Routes are **protected by default** — only `@Public()` routes work without a `Authorization: Bearer <token>` header.

### Auth

| Method | Path              | Body                                   | Response                      |
| ------ | ----------------- | -------------------------------------- | ----------------------------- |
| POST   | `/auth/register`  | `{ phoneNumber, password, displayName }` | `{ accessToken, user }` (201) / 409 duplicate / 400 validation |
| POST   | `/auth/login`     | `{ phoneNumber, password }`            | `{ accessToken, user }` (200) / 401 |
| GET    | `/auth/me`        | – *(token required)*                   | `UserProfile` / 401           |
| POST   | `/auth/password`  | `{ currentPassword, newPassword }` *(token required)* | 204 / 401 wrong current / 400 validation |

Phone numbers: 9–15 digits, optional leading `+`; spaces/dashes/parens are stripped on register, login and profile edits alike, so the same number typed differently always finds the same account. Passwords: 8–72 characters. Both routes that claim a phone number (`/auth/register`, `PATCH /users/me`) answer **409 duplicate** even when two requests race for it: the unique index is the real gate, and hitting it is reported as the conflict it is, never as a 500.

### Users (all require a token)

| Method | Path         | Body / Notes                                          | Response                        |
| ------ | ------------ | ----------------------------------------------------- | ------------------------------- |
| GET    | `/users/me`  | –                                                     | `UserProfile & { stats }` / 401 |
| PATCH  | `/users/me`  | `{ displayName?, phoneNumber? }` — phone must be free | `UserProfile` / 409 duplicate / 400 |

```jsonc
// GET /users/me — what the profile page shows
{ "id": 1, "phoneNumber": "+491701234567", "displayName": "Moonyyy", "balance": 0, "createdAt": "...",
  "stats": { "tablesCreated": 2,
             "seatedTables": [{ "id": 81, "name": "Moonyyy test table", "gameSlug": "poker",
                                "gameName": "Texas Hold'em Poker", "seatedCount": 8, "maxSeats": 8 }] } }
```

`stats.tablesCreated` counts the tables you opened; `stats.seatedTables` lists every table you hold a seat at right now (newest first), which the profile page turns into `/play/:slug/table/:id` rejoin links. Changing your phone number moves your login to it (your current token keeps working until it expires); changing your password requires the old one.

### Games

| Method | Path          | Response            |
| ------ | ------------- | ------------------- |
| GET    | `/games`      | `Game[]`            |
| GET    | `/games/:slug` | `Game` / 404       |

```jsonc
// UserProfile
{ "id": 1, "phoneNumber": "+491701234567", "displayName": "Moonyyy", "balance": 0, "createdAt": "..." }
// Game
{ "id": 1, "slug": "poker", "name": "Texas Hold'em Poker", "description": "...",
  "icon": "spade", "players": "2–8", "maxSeats": 8, "status": "available", "sortOrder": 1 }
```

### Tables (all require a token)

| Method | Path                  | Body / Notes                                                             | Response                            |
| ------ | --------------------- | ------------------------------------------------------------------------ | ----------------------------------- |
| GET    | `/games/:slug/tables` | –                                                                         | `TableSummary[]`                    |
| POST   | `/games/:slug/tables` | `{ name, maxSeats?, timeControl?, smallBlind?, bigBlind? }` — blinds in cents; `timeControl` is chess-only (`1+0`, `3+2`, `5+0`, `10+5`) and defaults to `3+2`; creator takes seat 1 | `TableDetails` (201) / 400 / 409 if the game is not open |
| GET    | `/tables/:id`         | –                                                                         | `TableDetails` / 404                |
| POST   | `/tables/:id/join`    | idempotent — keeps your seat if you already have one                      | `TableDetails` / 409 full / 404     |
| POST   | `/tables/:id/action`  | `{ type, amount?, tokenId?, tileId?, end?, from?, to?, promotion?, card?, color? }` — poker: `ready \| fold \| check \| call \| raise \| allin` (`amount` is the raise-to total in cents); Ludo: `roll \| move` (`tokenId` is which of your four tokens); Dominoes: `play \| draw \| pass` (`tileId` is which of your tiles, `end` is `left` / `right` / `start`); Chess: `ready \| move \| resign \| offer_draw \| accept_draw \| decline_draw` (`from` / `to` are squares like `e2` and `e4`, `promotion` is `q` / `r` / `b` / `n` and defaults to a queen; the draw actions need no extra fields); Uno: `play \| draw \| pass \| call_uno \| catch_uno` (`card` is a code like `R5`, `GS` or `WF`, `color` is `R` / `Y` / `G` / `B` and is required when the card is a wild) | `TableDetails` / 400 illegal or out of turn |
| POST   | `/tables/:id/leave`   | leaving mid-hand folds you; the last player leaving deletes the table     | 204                                 |
| POST   | `/tables/:id/invites` | `{ userId }` — you must be seated here and already friends; one open invite per friend per table | `PendingInvite[]` / 400 not friends / 403 not seated / 409 already seated or invited |
| GET    | `/tables/:id/invites` | the table's open invites, for the invite dialog's "Invited" state (seated players only) | `PendingInvite[]` / 403 |

`:id` is validated at the route: ids outside the column's range (`99999999999999999999`) or fractional ids answer 400, and ids that simply do not exist answer 404 — the database is never asked about an id it would reject.

```jsonc
// TableSummary
{ "id": 1, "name": "Moonyyy's table", "maxSeats": 8, "smallBlind": 100, "bigBlind": 200,
  "creatorName": "Moonyyy", "seatedCount": 2, "seatedUserIds": [1, 2], "createdAt": "..." }
// TableDetails — the shape is shared by every game; `game.kind` tells you which one you are looking at
// poker (seats are masked per viewer: `cards` is only your own hand — or any hand revealed at showdown)
{ "id": 1, "name": "Moonyyy's table", "maxSeats": 8, "smallBlind": 100, "bigBlind": 200,
  "gameSlug": "poker", "gameName": "Texas Hold'em Poker", "creatorName": "Moonyyy",
  "seats": [{ "seatIndex": 0, "userId": 1, "displayName": "Moonyyy", "stack": 19900, "bet": 100,
              "folded": false, "allIn": false, "ready": true, "status": "online",
              "lastAction": "Small blind", "cards": ["As", "Kd"] }],
  "game": { "kind": "poker", "phase": "preflop", "handNumber": 3, "pot": 300, "community": [], "currentBet": 200,
            "pots": [{ "amount": 300, "main": true, "level": 0, "eligibleUserIds": [1, 2] }],
            "potAwards": null,
            "dealerSeat": 0, "smallBlindSeat": 1, "bigBlindSeat": 2,
            "turnUserId": 1, "turnDeadline": 1792345511154, "serverNow": 1792345451154,
            "winners": null,
            "legal": { "fold": true, "check": false, "callAmount": 100, "callAllIn": false,
                       "raise": { "min": 400, "max": 20000 }, "allIn": true } } }
// ludo (`tokens` is the progress of the four tokens, "quadrant" the board corner 0..3)
{ "id": 7, "name": "Moonyyy's table", "maxSeats": 4, "smallBlind": null, "bigBlind": null,
  "gameSlug": "ludo", "gameName": "Ludo", "creatorName": "Moonyyy",
  "seats": [{ "seatIndex": 0, "userId": 1, "displayName": "Moonyyy", "stack": 0, "bet": 0,
              "folded": false, "allIn": false, "ready": true, "status": "online",
              "lastAction": "Rolled 6", "cards": null }],
  "game": { "kind": "ludo", "phase": "playing", "gameNumber": 2, "turnUserId": 1,
            "turnDeadline": 1792345511154, "serverNow": 1792345451154,
            "dice": 6, "lastRoll": 6, "winnerUserId": null,
            "legal": { "roll": false, "dice": 6, "moves": [{ "tokenId": 0, "steps": 0, "capture": false }] },
            "players": [{ "userId": 1, "seatIndex": 0, "quadrant": 0, "tokens": [-1, -1, -1, -1],
                          "lastAction": "Rolled 6", "home": 0 }] } }
// dominoes (`chain` is public — every tile is already oriented; `hand` is only yours)
{ "id": 12, "name": "Moonyyy's table", "maxSeats": 4, "smallBlind": null, "bigBlind": null,
  "gameSlug": "dominoes", "gameName": "Dominoes", "creatorName": "Moonyyy",
  "seats": [{ "seatIndex": 0, "userId": 1, "displayName": "Moonyyy", "stack": 0, "bet": 0,
              "folded": false, "allIn": false, "ready": true, "status": "online",
              "lastAction": "Played 4–5", "cards": null }],
  "game": { "kind": "dominoes", "phase": "playing", "gameNumber": 1, "turnUserId": 1,
            "turnDeadline": 1792345511154, "serverNow": 1792345451154,
            "boneyardCount": 14, "chain": [{ "tileId": 23, "left": 4, "right": 5 }],
            "leftEnd": 4, "rightEnd": 5,
            "hand": [{ "id": 0, "a": 0, "b": 0 }, { "id": 6, "a": 0, "b": 6 }, { "id": 12, "a": 1, "b": 6 },
                     { "id": 24, "a": 4, "b": 6 }, { "id": 26, "a": 5, "b": 6 }, { "id": 27, "a": 6, "b": 6 }],
            "legal": { "moves": [{ "tileId": 24, "end": "left" }], "draw": false, "pass": false },
            "resultReason": null, "winnerUserIds": [],
            "scores": [],
            "players": [{ "userId": 1, "seatIndex": 0, "handCount": 6,
                          "lastAction": "Played 4–5" }] } }
// chess (`board` is 64 squares, index 0 = a8 ... 63 = h1; `moves` is the SAN log)
{ "id": 21, "name": "Moonyyy's table", "maxSeats": 2, "smallBlind": null, "bigBlind": null,
  "gameSlug": "chess", "gameName": "Chess", "creatorName": "Moonyyy",
  "seats": [{ "seatIndex": 0, "userId": 1, "displayName": "Moonyyy", "stack": 0, "bet": 0,
              "folded": false, "allIn": false, "ready": true, "status": "online",
              "lastAction": "Qxf7#", "cards": null }],
  "game": { "kind": "chess", "phase": "finished", "gameNumber": 1, "turnUserId": null,
            "turnDeadline": null, "serverNow": 1792345451154, "turn": "b",
            "timeControl": { "id": "3+2", "initialMs": 180000, "incrementMs": 2000 },
            "clocks": { "w": 164000, "b": 0 }, "turnStartedAt": null, "drawOffer": null,
            "board": [{ "type": "r", "color": "b" }, null, /* … 62 more … */ { "type": "r", "color": "w" }],
            "castling": { "wK": true, "wQ": false, "bK": false, "bQ": false },
            "enPassant": null, "halfmoveClock": 0, "fullmoveNumber": 4, "inCheck": true,
            "lastMove": { "from": "h5", "to": "f7" },
            "moves": [{ "from": "e2", "to": "e4", "san": "e4", "piece": "p", "color": "w",
                        "captured": null, "promotion": null, "check": false, "checkmate": false }],
            "winnerUserId": 1,
            "result": { "winnerUserId": 1, "draw": false, "reason": "checkmate" },
            "legal": null,
            "players": [{ "userId": 1, "seatIndex": 0, "color": "w", "lastAction": "Qxf7#" }] } }
// uno (`hand` is only yours; `discardTop` + `activeColor` are the public pile)
{ "id": 34, "name": "Moonyyy's table", "maxSeats": 4, "smallBlind": null, "bigBlind": null,
  "gameSlug": "uno", "gameName": "Uno", "creatorName": "Moonyyy",
  "seats": [{ "seatIndex": 0, "userId": 1, "displayName": "Moonyyy", "stack": 0, "bet": 0,
              "folded": false, "allIn": false, "ready": false, "status": "online",
              "lastAction": "Played Blue Skip", "cards": null }],
  "game": { "kind": "uno", "phase": "playing", "gameNumber": 1, "turnUserId": 2,
            "turnDeadline": 1792345511154, "serverNow": 1792345451154,
            "direction": 1, "activeColor": "B", "discardTop": "BS", "drawCount": 82,
            "hand": ["R5", "R7", "G2", "YS", "W", "WF", "B9"],
            "pendingUno": { "userId": 2, "deadline": 1792345465154 },
            "winnerUserId": null, "winnerPoints": 0,
            "legal": { "playable": ["B9"], "drawnCard": null, "draw": true, "pass": false,
                       "callUno": false, "catchUserId": 2 },
            "players": [{ "userId": 1, "seatIndex": 0, "cardCount": 7,
                          "lastAction": "Played Blue Skip", "saidUno": false, "pendingUno": false },
                        { "userId": 2, "seatIndex": 1, "cardCount": 1,
                          "lastAction": "Played Green 4", "saidUno": false, "pendingUno": true }] } }
```

`game.phase` is `waiting` between hands (or `preflop` / `flop` / `turn` / `river` while a hand runs) for poker, and `waiting` / `playing` / `finished` for Ludo, Dominoes, Chess and Uno. `dealerSeat`, `smallBlindSeat` and `bigBlindSeat` are seat indexes; the button and the blind chips stay where the last hand left them while players ready up for the next one, then move together when it is dealt (heads-up the button posts the small blind, so both chips sit on that one seat). All three are `null` until the table's first hand. Card codes are rank + suit (`As` = ace of spades, `Td` = ten of diamonds). `legal` describes the *viewer's* allowed moves and is `null` when it isn't your turn; the turn countdown is `turnDeadline - serverNow`.

For poker, `game.pot` is everything that is in the pot, and `game.pots` breaks it down: the **main pot** first, then one entry per **side pot** — a side pot appears as soon as an all-in caps the pot that player can win, and `eligibleUserIds` names the players who can still win it. `level` is the contribution level the pot opens at (0 for the main pot). `potAwards` keeps the last hand's breakdown, so the room can say who took which pot. `legal.callAllIn` is `true` when calling uses the whole stack — the player is all-in after it.

`seats[].status` is the presence dot the rooms draw next to each name: `online` (green), `offline` (red) or `not-ready` (amber). It is decided per viewer — your own seat is never `offline`, because the request that fetched the table proves you are there — and `not-ready` only exists in the `waiting` phase, where a player holding the game up matters more than a colour. See "Presence" in the notes below for how the server decides it.

In Ludo a token's progress is `-1` in the base, `0–51` on the shared ring, `52–56` inside the owner's home column and `57` home, and `dice` is the roll waiting to be used (`lastRoll` keeps the last roll on screen between turns). `legal.moves` lists exactly which tokens may move and where they would land; `capture: true` means the move sends an opponent token back to its base. The action `roll` and `move` are Ludo-only (`400` on a poker table), just as `fold`/`raise` are poker-only.

In Dominoes `chain` is the whole board, left to right, every tile already oriented as `{ tileId, left, right }` — it is public data, so the room draws it verbatim — and `leftEnd` / `rightEnd` are the pips that are still open. Only `hand` is masked: it holds **your** tiles, while everyone in `players` exposes just `handCount` and `lastAction` — pip totals stay on the server, like the tiles themselves. `legal.moves` lists the exact `(tileId, end)` pairs that fit (`end: "start"` covers the opening play; when both open ends show the same pip only one of `left`/`right` is offered, because the result would be identical), and `legal.draw` / `legal.pass` cover a hand with no fit — draw while the boneyard still has tiles (and the table is not a three-player one), pass once it is empty, or whenever a three-player table has no playable tile. A finished round carries `resultReason` (`hand`, `blocked` or `forfeit`) with `winnerUserIds` and the end-of-round `scores`. The actions `play`, `draw` and `pass` are Dominoes-only (`400` on any other table), just as `fold`/`raise` are poker-only.

In Chess nothing is masked — the whole position is public, so `board`, `castling`, `enPassant` and the move log are the same for both players, and `players[].color` tells each viewer which side they own (the room flips the board for Black). `board` is indexed like FEN (`0` = a8 … `63` = h1) and holds `{ type, color }` or `null`; `castling` tracks `wK` / `wQ` / `bK` / `bQ` rights, `enPassant` is the square a double pawn push skipped (or `null`), `halfmoveClock` counts plies since the last pawn move or capture (100 draws), and `fullmoveNumber` is the move counter. `legal.moves` lists the exact `(from, to, promotion)` triples the viewer may play — a promotion move appears once per piece it could become — and `legal.resign` is always `true` while you are on the move. Each table is created with a **time control**: `timeControl` resolves it to `initialMs` / `incrementMs`, `clocks` is what each side has left, and `turnStartedAt` is when the side on the move started thinking, so `turnDeadline = turnStartedAt + clocks[turn]` and a client counts down exactly like the server. The mover is charged for the time they used and gains the increment; a flag fall loses unless the opponent could not mate even with help, which is a draw (FIDE 6.9). `drawOffer` names the player with a standing offer (or `null`), and a move by the other player declines it. A finished game carries `result` (`reason` is `checkmate`, `stalemate`, `resignation`, `abandoned`, `timeout`, `fifty-move`, `insufficient-material`, `threefold` or `agreement`, plus `winnerUserId` and `draw`) and copies the winner into `winnerUserId`; `move.san` is the notation the room shows, with `+` for check and `#` for mate. Draws are automatic on the third occurrence of the same position (same pieces, side to move and castling rights — an en passant square only counts when a pawn can really capture on it, FIDE 9.2.2), at 100 plies without a pawn move or capture, and when the position is dead (FIDE 5.2.2: kings alone, a lone minor against a bare king, two knights against a bare king, and two bishops on squares of the same colour — while two knights, a bishop against a knight, or bishops on opposite colours can still be mated with help and keep playing). The actions `move`, `resign`, `offer_draw`, `accept_draw` and `decline_draw` are Chess-only (`400` on any other table), just as `fold`/`raise` are poker-only.

In Uno cards are compact codes — colour (`R`, `Y`, `G`, `B`) plus value (`0`–`9`, `S` = skip, `R` = reverse, `D` = draw two), with `W` and `WF` for the two wilds, so `R5` is a red five and `WF` a wild draw four. `discardTop` and `activeColor` are public: the pile everyone plays against and the colour it currently demands (a wild sets the colour without changing the card on top). `drawCount` is what is left in the draw pile — the discard pile recycles into it, so it can go back up. Only `hand` is masked, holding **your** cards; everyone in `players` exposes just `cardCount`, `lastAction`, `saidUno` and `pendingUno`. `legal.playable` lists exactly the cards you may play right now (`legal.drawnCard` is set after you draw, and then it is the only card you may play — or you may `pass`), `legal.callUno` is true while you are down to one card and have not called UNO yet, and `legal.catchUserId` names the player **you** may catch for not calling it. A finished game carries `winnerUserId` and `winnerPoints` (numbers face value, action cards 20, wilds 50, summed over the other hands). The actions `play`, `draw`, `pass`, `call_uno` and `catch_uno` are Uno-only (`400` on any other table), just as `fold`/`raise` are poker-only.

### Friends & invites (all require a token)

| Method | Path                            | Body / Notes                                                          | Response                                     |
| ------ | ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------- |
| GET    | `/friends`                      | –                                                                     | `FriendsOverview`                            |
| GET    | `/friends/search?q=`            | display name or phone digits; 2+ characters (shorter queries answer `[]`) | `PlayerSearchResult[]`                       |
| POST   | `/friends/requests`             | `{ userId }` — if they already asked you, this accepts instead          | `FriendsOverview` / 400 self / 404 unknown / 409 already friends or already sent |
| POST   | `/friends/requests/:id/accept`  | a request addressed to you                                            | `FriendsOverview` / 404 not open             |
| POST   | `/friends/requests/:id/decline` | drops the request                                                     | `FriendsOverview` / 404 not open             |
| DELETE | `/friends/requests/:id`         | takes back a request you sent                                         | `FriendsOverview` / 404 not open             |
| DELETE | `/friends/:userId`              | unfriends in either direction                                         | `FriendsOverview` / 404 not friends          |
| GET    | `/invites`                      | open table invites addressed to you, newest first                     | `TableInvite[]`                              |
| POST   | `/invites/:id/accept`           | seats you at the table and closes the invite                          | `TableDetails` / 404 gone / 409 full         |
| POST   | `/invites/:id/decline`          | closes the invite — the inviter may ask again later                    | 204 / 404 gone                               |

A request is one `friendships` row running from the requester to the addressee; accepting flips it to `accepted`, while declining or cancelling deletes it so the request can be sent again later. Sending a request to someone who already asked you accepts theirs. Every mutation answers with the viewer's fresh `FriendsOverview`, so the page and the navbar badge update from one response. Time is deliberately not stored in the invite: a pending row exists only while the offer stands — the table disappearing cascades it away, and `GET /invites` silently drops invites to tables you already sit at.

```jsonc
// FriendsOverview
{ "friends": [{ "id": 2, "displayName": "Ada", "phoneNumber": "+491701234568",
                "status": "online", "lastSeenAt": "...", "friendsSince": "..." }],
  "incoming": [{ "id": 7, "userId": 3, "displayName": "Grace", "phoneNumber": "+491701234569",
                 "status": "offline", "createdAt": "..." }],
  "outgoing": [] }
// PlayerSearchResult — `requestId` is set when the pending request is theirs,
// so the button can accept it right from the search result
{ "id": 3, "displayName": "Grace", "phoneNumber": "+491701234569",
  "status": "offline", "relation": "incoming", "requestId": 7 }
// TableInvite
{ "id": 4, "tableId": 81, "tableName": "Friday night", "gameSlug": "poker",
  "gameName": "Texas Hold'em Poker", "inviterId": 2, "inviterName": "Ada",
  "seatedCount": 3, "maxSeats": 6, "createdAt": "..." }
```

Friend presence reads the same `lastSeenAt` window as the seat dots (see **Presence** below); the friends page and the navbar poll it every 15 seconds and refresh on tab focus, so a friend coming online shows up without a reload.

### Tasks (legacy example)

The original CRUD demo still lives at `/tasks` but is now **behind the auth guard** (`GET /tasks` without a token returns 401). It stays as a REST/CRUD reference.

## Root scripts

| Script                | What it does                                      |
| --------------------- | ------------------------------------------------- |
| `npm run dev`         | Runs backend (watch mode) + frontend concurrently |
| `npm run dev:api`     | Backend only — <http://localhost:3000>            |
| `npm run dev:web`     | Frontend only — <http://localhost:5173>           |
| `npm run db:up`       | Starts PostgreSQL in Docker                       |
| `npm run db:down`     | Stops the database container                      |
| `npm run db:logs`     | Follows database logs                             |
| `npm run install:all` | Installs backend + frontend dependencies          |
| `npm run build`       | Production build of both apps                     |

## Roadmap

1. **Real-time layer** — WebSocket (socket.io) rooms: replace the polling (5 s lobby / ~1 s room) with live presence (seat dots today come from the request heartbeat), seating and table chat.
2. **More Ludo depth** — team play (2v2), a move log, and standings for 3–4 player tables.
3. **Real money** — wallet top-ups/withdrawals, KYC — the `balance` field is already in place.

## Notes

- **Database port is `5433`** to avoid clashing with a locally installed PostgreSQL on `5432`.
- Dev credentials: user `app`, password `app_password`, database `app_db` (see `docker-compose.yml` and `backend/.env`). Change them for anything beyond local development.
- Inspect data: `docker compose exec db psql -U app -d app_db`
- The frontend calls `/api/...`; Vite proxies those requests to the backend in dev (`frontend/vite.config.ts`), so no CORS friction. CORS is also enabled for `http://localhost:5173` in `backend/src/main.ts` for direct API calls.
- **UI rule of this repo**: every UI piece is a **shadcn/ui component used as-is** (never edit files under `frontend/src/components/ui/`). Add more with `npx shadcn@latest add <name>`. Page layouts compose those components. That includes the home reel — its stills and cue cells are shadcn `Button`s (flattened with `className`, never replaced by hand-rolled elements), the reel's edge controls are `Button`s, and the detail view is a shadcn `Dialog` + `DialogContent`, so focus trapping, Escape, the scroll lock and the close button come from the component library. There is no raw `<button>` anywhere in `frontend/src` outside `components/ui/`.
- **Animation rule of this repo**: motion comes from **Motion** (`motion`, imported from `motion/react`) — not hand-rolled CSS keyframes for state changes. `MotionConfig reducedMotion="user"` sits at the app root, so anyone whose system asks for reduced motion gets opacity/colour changes without movement. The home reel is where most of it lives: each still is positioned from its distance to the active cue (`rotateY` 58°, scale, blur — transform/filter/opacity only, so nothing reflows), the cue frame is a shared `layoutId` that morphs between cells, and opening a still flips it from the reel into the detail dialog. Motion animates the components shadcn provides — it never replaces them: the still keeps one shared `layoutId` across the reel and the `Dialog`, so the flip is the same element changing place, and the dialog hands focus back to that very still when it closes. The rooms use it for the moves that matter: a chess piece springs to its square, and in Uno every card that lands on the discard pile flips in on a spring while the live colour breathes behind the pile.
- Set `JWT_SECRET` in `backend/.env` to a long random string (`openssl rand -hex 32`); tokens are valid for `JWT_EXPIRES_IN` (default `7d`) and stored in `localStorage` on the client (swap for httpOnly cookies before real money).
- **Table defaults** from the settings page are a browser preference, not account data: they live in `localStorage` (`gamehub_table_defaults`), are clamped to what each game allows (2–8 seats, so 6 becomes 4 at a Ludo table), and are only read when the create-table dialog opens.
- Seats are plain HTTP rows for now: opening a table link seats you, **Leave table** in the room menu frees the seat, and closing the room with the back arrow keeps it (so you can return). Until the WebSocket layer lands, tables and seats refresh via polling (5 s lobby, ~1 s room), and the server advances turns/timeouts whenever anyone polls.
- **Presence** (the seat dots) is derived from that polling, since there are no sockets yet: every authenticated request stamps `users.lastSeenAt`, written at most once every 10 seconds per user so a one-second room poll never becomes a write per second. A player is **online** while their last call is inside a 30-second window and **offline** after that — closing the tab turns the dot red within about half a minute. `not-ready` (amber) is the waiting phase only: online, but holding the start of the game up. Login and registration stamp presence immediately, and your own seat is never `offline`. The rule is a pure function in `backend/src/users/presence.ts` (unit-tested), fed by `UsersService.touch()` behind the auth guard.
- **Game state lives in `tables.state` (jsonb)** and is only ever changed inside a row-locked transaction, so two players acting at the same instant can't corrupt a hand or a race. Each game is a set of pure functions — `backend/src/poker/`, `backend/src/ludo/`, `backend/src/dominoes/`, `backend/src/chess/` and `backend/src/uno/` — and `src/tables/tables.service.ts` dispatches every call to the engine that matches `table.game.slug`. `npm test` in `backend/` runs the engines' unit tests (blinds/order, min-raise, side pots, the uncalled bet, the incomplete-raise rule, showdown, timeouts; base exit, captures, safe squares, exact home, three sixes, timeouts; the domino deal and starter, both-end matching, boneyard draws, a blocked round on pips, a full lap of passes, timeouts; chess move generation, castling through check, en passant, promotion, checkmate and stalemate, the fifty-move and insufficient-material draws, clocks and increments, threefold repetition, draw offers and the FIDE flag rule, FEN round-trips; the Uno deck and card scoring, matching and wild colours, the draw-four restriction, skips/reverses/draws, the UNO call window and its penalty, timeouts) and `npm run test:e2e` plays a real hand, a real Ludo race, a real Dominoes round, a real chess game *and* a real Uno game between two accounts through the HTTP API — Scholar's mate played move by move, a pawn promoted to the piece the player picked, a clock picked at creation with the mover's bank charged, a resignation, a flag fall, a draw declined and then agreed, a UNO call and a catch for a missed one played out over HTTP, including a player going quiet so their seat dot turns red (needs the database container). The poker engine follows the usual no-limit hold'em rules: the **full bet rule** (a short all-in raise does not reopen the betting), **side pots** cut off by every all-in, the **uncalled part of a bet** handed back to the bettor, the big blind's option, and a short blind that still has to be called in full.
- Game rooms are rendered at a fixed design size and scaled as one unit (`zoom` + `ResizeObserver`), so the action buttons can't be pushed off-screen — the game screens never scroll. The home reel is a one-screen page too: its height is fixed to the viewport (`100dvh` − navbar) instead of growing with its content, the document scroll is locked while it is mounted, the wheel listener on the reel is native and non-passive (React attaches `onWheel` passively, which is why a nudge used to step the reel *and* scroll the page), the stills are sized from the measured stage, and the header/cue-sheet paddings tighten on short viewports — so it fits portrait phones, landscape phones and desktop without scrolling, and the scroll lock is released as soon as you leave home. The game lobby, profile and settings scroll normally. The Ludo room scales its seat strip, board and legend together the same way, and the board is drawn from server state only: nothing about a token's position is decided in the browser. The Dominoes room does the same with its seat strip, chain and hand — the chain can never spill over the controls, and tile sizes shrink as the chain grows so the whole round stays on one screen. The Chess room scales its seat strip, 8×8 board, captured-pieces rail and legend together too, so the board can never cover the Ready and Resign controls. The Uno room does the same with its seat strip, felt and hand: the felt is a fixed 430×252 design box, the hand only starts overlapping once the row would run past the room's width, so a twenty-card hand still fits without a scrollbar.
- `synchronize: true` (in `backend/src/app.module.ts`) is convenient for development but should be replaced by TypeORM migrations before production.
- The backend is an ESM project (`"type": "module"`), so relative imports use `.js` extensions.
