export interface User {
  id: number
  phoneNumber: string
  displayName: string
  /** Virtual balance in cents. */
  balance: number
  createdAt: string
  role: 'player' | 'admin'
}

export interface AdminUserInfo {
  id: number
  phoneNumber: string
  displayName: string
  balance: number
}

export interface AdminAdjustmentInfo {
  id: number
  userId: number
  phoneNumber: string
  displayName: string
  amountCents: number
  kind: 'admin_credit' | 'admin_withdrawal'
  balance: number
  createdAt: string
}

export interface WalletRequestInfo {
  id: number
  userId: number
  phoneNumber: string
  displayName: string
  kind: 'deposit' | 'withdrawal'
  amountCents: number
  status: 'pending' | 'accepted' | 'declined'
  createdAt: string
  reviewedAt: string | null
}

export type GameStatus = 'available' | 'coming_soon'

export interface Game {
  id: number
  slug: string
  name: string
  description: string
  icon: string
  players: string
  maxSeats: number
  status: GameStatus
  sortOrder: number
}

export interface TableSummary {
  id: number
  name: string
  maxSeats: number
  entryFee: number | null
  smallBlind: number | null
  bigBlind: number | null
  /** Chess only: the clock the creator picked, e.g. "3+2". */
  timeControl: string | null
  /** Seconds per turn for non-chess games. */
  turnSeconds: number | null
  creatorName: string
  seatedCount: number
  seatedUserIds: number[]
  createdAt: string
}

export interface GameResult {
  id: number
  tableId: number
  tableName: string
  gameSlug: string
  gameNumber: number
  outcome: 'won' | 'lost' | 'draw'
  summary: string
  opponentNames: string[]
  finishedAt: string
}

export interface TableSeat {
  seatIndex: number
  userId: number
  displayName: string
  /** Chips behind at the poker table, in cents. */
  stack: number
  /** Chips committed on the current street, in cents. */
  bet: number
  folded: boolean
  allIn: boolean
  ready: boolean
  /** Presence for the seat dot: green online, red offline, amber not ready. */
  status: SeatStatus
  lastAction: string | null
  /** Your own hole cards, or hands revealed at showdown; null when hidden. */
  cards: string[] | null
}

/**
 * How a seat's player is doing, from the server: online (green), offline
 * (red), or here but not readied up while a game waits on them (amber).
 */
export type SeatStatus = 'online' | 'offline' | 'not-ready'

export type TablePhase = 'waiting' | 'preflop' | 'flop' | 'turn' | 'river'

export interface TableLegalActions {
  fold: boolean
  check: boolean
  /** Chips needed to call; null when there is nothing to call. */
  callAmount: number | null
  /** The call uses the whole stack — the player is all-in after it. */
  callAllIn: boolean
  /** Allowed street-bet totals when raising; null when raising is impossible. */
  raise: { min: number; max: number } | null
  /** An all-in raise is possible. */
  allIn: boolean
}

export interface GameWinner {
  userId: number
  amount: number
  hand: string | null
}

/** One pot of the hand: the main pot, or a side pot cut off by an all-in. */
export interface TablePot {
  /** Chips in this pot. */
  amount: number
  /** True for the main pot — the first one. */
  main: boolean
  /** The contribution level that opens this pot; 0 for the main pot. */
  level: number
  /** The players who can still win this pot. */
  eligibleUserIds: number[]
}

/** How a pot was settled: who took it and how much of it each took. */
export interface TablePotAward {
  amount: number
  main: boolean
  winners: GameWinner[]
}

export interface TableGame {
  kind: 'poker'
  phase: TablePhase
  handNumber: number
  pot: number
  /** The main pot and every side pot of the hand. */
  pots: TablePot[]
  /** How the pots of the last hand were split. */
  potAwards: TablePotAward[] | null
  community: string[]
  currentBet: number
  dealerSeat: number | null
  /** Seats that posted the blinds — kept on show until the next hand. */
  smallBlindSeat: number | null
  bigBlindSeat: number | null
  turnUserId: number | null
  turnDeadline: number | null
  /** Server clock at response time — used to count the turn timer down. */
  serverNow: number
  winners: GameWinner[] | null
  legal: TableLegalActions | null
}

export type LudoPhase = 'waiting' | 'playing' | 'finished'

export interface LudoMove {
  tokenId: number
  /** Progress the token would land on. */
  steps: number
  /** The move would send an opponent token back to its base. */
  capture: boolean
}

export interface LudoLegalActions {
  roll: boolean
  /** The roll waiting to be played, when a token must be picked. */
  dice: number | null
  moves: LudoMove[]
}

export interface LudoPlayer {
  userId: number
  seatIndex: number
  /** Board corner 0..3 (top-left, top-right, bottom-right, bottom-left). */
  quadrant: number
  /** Progress of the four tokens: -1 base, 0..51 track, 52..56 home column, 57 home. */
  tokens: number[]
  lastAction: string | null
  home: number
}

export interface LudoGame {
  kind: 'ludo'
  phase: LudoPhase
  gameNumber: number
  turnUserId: number | null
  turnDeadline: number | null
  /** Server clock at response time — used to count the turn timer down. */
  serverNow: number
  /** The roll waiting to be played, when a token must be picked. */
  dice: number | null
  /** The last roll, kept on screen between turns. */
  lastRoll: number | null
  winnerUserId: number | null
  legal: LudoLegalActions | null
  players: LudoPlayer[]
}

export type DominoesPhase = 'waiting' | 'playing' | 'finished'

/** Which end of the chain a tile is played on. */
export type DominoesEnd = 'left' | 'right' | 'start'

export interface DominoesTile {
  id: number
  a: number
  b: number
}

/** One tile as it sits in the chain, already oriented left half to right half. */
export interface DominoesChainTile {
  tileId: number
  left: number
  right: number
}

export interface DominoesMove {
  tileId: number
  end: DominoesEnd
}

export interface DominoesLegalActions {
  moves: DominoesMove[]
  /** No tile fits and the boneyard still has tiles. */
  draw: boolean
  /** No tile fits and the boneyard is empty. */
  pass: boolean
}

export interface DominoesPlayerInfo {
  userId: number
  seatIndex: number
  /** How many tiles this player holds — never which ones or what they are worth. */
  handCount: number
  lastAction: string | null
}

export interface DominoesScore {
  userId: number
  pips: number
}

export interface DominoesGame {
  kind: 'dominoes'
  phase: DominoesPhase
  gameNumber: number
  turnUserId: number | null
  turnDeadline: number | null
  /** Server clock at response time — used to count the turn timer down. */
  serverNow: number
  boneyardCount: number
  /** The chain from left to right, every tile already oriented. */
  chain: DominoesChainTile[]
  leftEnd: number | null
  rightEnd: number | null
  /** Only your own tiles. */
  hand: DominoesTile[]
  legal: DominoesLegalActions | null
  /** How the last round ended — drives the result copy in the room. */
  resultReason: 'hand' | 'blocked' | 'forfeit' | null
  winnerUserIds: number[]
  scores: DominoesScore[]
  players: DominoesPlayerInfo[]
}

export type ChessColor = 'w' | 'b'

export type ChessPieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k'

export type ChessPromotion = 'q' | 'r' | 'b' | 'n'

export type ChessPhase = 'waiting' | 'playing' | 'finished'

export type ChessEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'resignation'
  | 'abandoned'
  | 'timeout'
  | 'fifty-move'
  | 'insufficient-material'
  | 'threefold'
  | 'agreement'

export interface ChessPiece {
  type: ChessPieceType
  color: ChessColor
}

export interface ChessCastlingRights {
  wK: boolean
  wQ: boolean
  bK: boolean
  bQ: boolean
}

/** One move the viewer may send; a pawn promotion carries its piece. */
export interface ChessLegalMove {
  from: string
  to: string
  promotion: ChessPromotion | null
  /** 'k' or 'q' when the move is a castle — the room marks it as such. */
  castle: 'k' | 'q' | null
}

export interface ChessLegalActions {
  moves: ChessLegalMove[]
  resign: boolean
}

/** One entry of the game's move log, with the SAN the room displays. */
export interface ChessMoveRecord {
  from: string
  to: string
  san: string
  piece: ChessPieceType
  color: ChessColor
  captured: ChessPieceType | null
  promotion: ChessPromotion | null
  check: boolean
  checkmate: boolean
}

export interface ChessPlayer {
  userId: number
  seatIndex: number
  color: ChessColor
  lastAction: string | null
}

export interface ChessResult {
  winnerUserId: number | null
  draw: boolean
  reason: ChessEndReason
}

/** The clock a chess table was created with, resolved to milliseconds. */
export interface ChessTimeControlInfo {
  id: string
  initialMs: number
  incrementMs: number
}

export interface ChessGame {
  kind: 'chess'
  phase: ChessPhase
  gameNumber: number
  turnUserId: number | null
  turnDeadline: number | null
  /** Server clock at response time — used to count the turn timer down. */
  serverNow: number
  turn: ChessColor
  /** 64 squares, index 0 = a8 ... 63 = h1; null on an empty square. */
  board: (ChessPiece | null)[]
  castling: ChessCastlingRights
  enPassant: string | null
  halfmoveClock: number
  fullmoveNumber: number
  /** The side to move is in check. */
  inCheck: boolean
  /** The last move, kept on screen so both players see it. */
  lastMove: { from: string; to: string } | null
  moves: ChessMoveRecord[]
  winnerUserId: number | null
  result: ChessResult | null
  legal: ChessLegalActions | null
  players: ChessPlayer[]
  /** The table's clock, e.g. 3+2, and what each side has left. */
  timeControl: ChessTimeControlInfo
  clocks: Record<ChessColor, number>
  /** When the side to move started their clock, on the server's clock. */
  turnStartedAt: number | null
  /** A standing draw offer from one of the players, or null. */
  drawOffer: { userId: number; color: ChessColor } | null
}

export type UnoPhase = 'waiting' | 'playing' | 'finished'

/** The four card colours; wilds are the `W` pseudo-colour on the card codes. */
export type UnoColor = 'R' | 'Y' | 'G' | 'B'

export interface UnoLegalActions {
  /** Cards the viewer may play right now; empty when it is not their turn. */
  playable: string[]
  /** The card the viewer just drew — only it may be played. */
  drawnCard: string | null
  /** The viewer still has to draw this turn. */
  draw: boolean
  /** The viewer drew a playable card and may pass instead of playing it. */
  pass: boolean
  /** The viewer has one card left and can still call UNO. */
  callUno: boolean
  /** Someone else has one card left without calling UNO — you can catch them. */
  catchUserId: number | null
  /** A Wild Draw Four was just played and the viewer (victim) may challenge it. */
  challengeWf4: { offenderUserId: number; victimUserId: number } | null
}

export interface UnoPlayer {
  userId: number
  seatIndex: number
  /** How many cards this player holds — never which ones. */
  cardCount: number
  lastAction: string | null
  /** One card left and UNO was called. */
  saidUno: boolean
  /** One card left without calling UNO — anyone may catch them. */
  pendingUno: boolean
}

export interface UnoPendingUno {
  userId: number
  /** After this instant the player is safe — nobody caught them in time. */
  deadline: number
}

export interface UnoGame {
  kind: 'uno'
  phase: UnoPhase
  gameNumber: number
  turnUserId: number | null
  turnDeadline: number | null
  /** Server clock at response time — used to count the turn timer down. */
  serverNow: number
  /** 1 = clockwise, -1 = counter-clockwise. */
  direction: 1 | -1
  /** The colour that must currently be matched. */
  activeColor: UnoColor
  /** Top of the discard pile — the card everyone plays against. */
  discardTop: string | null
  /** Cards left in the draw pile (the discard pile recycles into it). */
  drawCount: number
  /** Your own hand — never anyone else's. */
  hand: string[]
  /** A player with one card who has not called UNO yet. */
  pendingUno: UnoPendingUno | null
  winnerUserId: number | null
  /** Points the winner scored from the other hands in this round. */
  winnerPoints: number
  /** Running match scores — first to 500 wins the match. */
  matchScores: Record<number, number>
  /** The user who won the match (500+ points), if any. */
  matchWinnerUserId: number | null
  legal: UnoLegalActions | null
  players: UnoPlayer[]
}

/** The game-specific half of a table payload — one shape per game slug. */
export type TableGameInfo =
  | TableGame
  | LudoGame
  | DominoesGame
  | ChessGame
  | UnoGame

export interface TableDetails {
  id: number
  name: string
  maxSeats: number
  entryFee: number | null
  smallBlind: number | null
  bigBlind: number | null
  gameSlug: string
  gameName: string
  creatorName: string
  seats: TableSeat[]
  game: TableGameInfo
}

/** A table the signed-in user currently holds a seat at. */
export interface SeatedTableSummary {
  id: number
  name: string
  gameSlug: string
  gameName: string
  seatedCount: number
  maxSeats: number
}

export interface UserStats {
  /** Tables this user opened. */
  tablesCreated: number
  /** Tables this user is sitting at right now — rejoin straight from here. */
  seatedTables: SeatedTableSummary[]
  recentResults: GameResult[]
  gameStats: { gameSlug: string; played: number; won: number; drawn: number }[]
}

/** `/users/me` — the profile plus what the player is up to. */
export interface UserProfile extends User {
  stats: UserStats
}

/** Presence on a friend row — the seat dot without the "not-ready" case. */
export type FriendStatus = Extract<SeatStatus, 'online' | 'offline'>

/** An accepted friend, as the friends page and invite dialog show them. */
export interface Friend {
  id: number
  displayName: string
  status: FriendStatus
  lastSeenAt: string | null
  friendsSince: string
}

/** A pending friend request, from either side. `id` is the request to answer. */
export interface FriendRequestInfo {
  id: number
  userId: number
  displayName: string
  status: FriendStatus
  createdAt: string
}

/** `GET /friends` — everything the friends page needs in one payload. */
export interface FriendsOverview {
  friends: Friend[]
  incoming: FriendRequestInfo[]
  outgoing: FriendRequestInfo[]
}

/** Where you stand with a player you found in search. */
export type FriendRelation = 'none' | 'friends' | 'outgoing' | 'incoming'

export interface PlayerSearchResult {
  id: number
  displayName: string
  status: FriendStatus
  relation: FriendRelation
  /** The request to accept right away when the request is theirs. */
  requestId: number | null
}

/** An open seat offer, as the invited friend sees it. */
export interface TableInvite {
  id: number
  tableId: number
  tableName: string
  gameSlug: string
  gameName: string
  inviterId: number
  inviterName: string
  seatedCount: number
  maxSeats: number
  entryFee: number | null
  createdAt: string
}

/** An open invite on a table, as the invite dialog's "Invited" state. */
export interface PendingInvite {
  id: number
  inviteeId: number
  createdAt: string
}
