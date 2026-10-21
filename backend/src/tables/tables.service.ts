import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import { Game } from '../games/game.entity.js';
import { FriendsService } from '../friends/friends.service.js';
import { isUniqueViolation } from '../users/db-errors.js';
import { User } from '../users/user.entity.js';
import {
  acceptChessDraw,
  createChessState,
  declineChessDraw,
  DEFAULT_CHESS_TIME_CONTROL,
  everyoneChessReady,
  findChessTimeControl,
  initialChessBoard,
  isChessPlaying,
  isInCheck,
  leaveChess,
  legalChessActions,
  markChessReady,
  normalizeChessState,
  offerChessDraw,
  playChessMove,
  resignChess,
  startChess,
  tickChess,
  type ChessLegalActions,
  type ChessMoveRecord,
  type ChessPhase,
  type ChessColor,
  type ChessCastlingRights,
  type ChessPiece,
  type ChessResult,
  type ChessState,
} from '../chess/chess-engine.js';
import {
  createDominoesState,
  dominoesTile,
  drawDominoes,
  everyoneDominoesReady,
  isDominoesPlaying,
  leaveDominoes,
  legalDominoesActions,
  markDominoesReady,
  passDominoes,
  playDominoes,
  startDominoes,
  tickDominoes,
  type DominoesEnd,
  type DominoesLegalActions,
  type DominoesPhase,
  type DominoesState,
} from '../dominoes/dominoes-engine.js';
import {
  createLudoState,
  everyoneLudoReady,
  homeCount,
  isLudoPlaying,
  leaveLudo,
  legalLudoActions,
  markLudoReady,
  moveLudo,
  rollLudo,
  startLudo,
  tickLudo,
  type LudoLegalActions,
  type LudoPhase,
  type LudoState,
} from '../ludo/ludo-engine.js';
import {
  applyAction,
  createState,
  everyoneReady,
  forceFold,
  isBettingPhase,
  legalActionsFor,
  markReady,
  normalizeState,
  potTotal,
  potsFor,
  startHand,
  tickTimeouts,
  type GameState,
  type LegalActions,
  type Phase,
} from '../poker/poker-engine.js';
import {
  applyUnoAction,
  createUnoState,
  everyoneUnoReady,
  isUnoPlaying,
  leaveUno,
  legalUnoActions,
  markUnoReady,
  startUno,
  tickUno,
  topDiscard,
  type UnoColor,
  type UnoLegalActions,
  type UnoPhase,
  type UnoState,
} from '../uno/uno-engine.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { TableActionDto } from './dto/table-action.dto.js';
import { TableInvite } from './table-invite.entity.js';
import { TablePlayer } from './table-player.entity.js';
import { Table } from './table.entity.js';
import { GameResult } from './game-result.entity.js';
import { completedGame } from './game-result.js';
import { GameEventsService } from './game-events.service.js';
import { seatStatus, type SeatStatus } from '../users/presence.js';
import { WalletEntry } from '../wallet/wallet-entry.entity.js';

/** Blinds and buy-in used when a table was created without stakes. */
const DEFAULT_BIG_BLIND = 200;
const BIG_BLINDS_PER_BUY_IN = 100;
/** How long a player has to act before the server auto-checks/folds. */
const TURN_MS = 60_000;
/** How long a Ludo player has to roll or move before the server plays it. */
const LUDO_TURN_MS = 45_000;
/** How long a Dominoes player has before the server plays for them. */
const DOMINOES_TURN_MS = 45_000;
/** How long an Uno player has to act before the server plays for them. */
const UNO_TURN_MS = 45_000;
const TABLE_NAME_LIMIT = 40;
const TABLE_NAME_CODE_BYTES = 6; // Eight base64url characters.
const TABLE_NAME_ATTEMPTS = 5;

function tableNameBase(gameSlug: string, displayName: string): string {
  const prefix = (gameSlug === 'chess' ? 'echec' : gameSlug).slice(
    0,
    TABLE_NAME_LIMIT - 14,
  );
  const username = displayName
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  const maxUsernameLength = TABLE_NAME_LIMIT - prefix.length - 10;
  const shortened = Array.from(username)
    .slice(0, maxUsernameLength)
    .join('')
    .replace(/_+$/g, '');
  return `${prefix}-${shortened || 'user'}`;
}

export interface TableSeatInfo {
  seatIndex: number;
  userId: number;
  displayName: string;
  /** Chips behind at the poker table; 0 for games without chips. */
  stack: number;
  /** Chips committed on the current street; 0 for games without chips. */
  bet: number;
  folded: boolean;
  allIn: boolean;
  ready: boolean;
  /** Presence for the seat dot: online, offline or waiting to ready up. */
  status: SeatStatus;
  lastAction: string | null;
  /** Only your own hole cards (or hands revealed at showdown). */
  cards: string[] | null;
}

export interface GameWinnerInfo {
  userId: number;
  amount: number;
  hand: string | null;
}

/** One pot of the hand: the main pot, or a side pot cut off by an all-in. */
export interface PotInfo {
  /** Chips in this pot. */
  amount: number;
  /** True for the main pot — the first one. */
  main: boolean;
  /** The contribution level that opens this pot; 0 for the main pot. */
  level: number;
  /** The players who can still win this pot. */
  eligibleUserIds: number[];
}

/** How a pot was settled: who took it and how much of it each took. */
export interface PotAwardInfo {
  amount: number;
  main: boolean;
  winners: GameWinnerInfo[];
}

export interface TableGameInfo {
  kind: 'poker';
  phase: Phase;
  handNumber: number;
  pot: number;
  /** The main pot and every side pot of the hand. */
  pots: PotInfo[];
  /** How the pots of the last hand were split. */
  potAwards: PotAwardInfo[] | null;
  community: string[];
  currentBet: number;
  dealerSeat: number | null;
  /** Seats that posted the blinds — kept on show until the next hand. */
  smallBlindSeat: number | null;
  bigBlindSeat: number | null;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** Server clock so clients can count the turn timer down accurately. */
  serverNow: number;
  winners: GameWinnerInfo[] | null;
  legal: LegalActions | null;
}

export interface LudoPlayerInfo {
  userId: number;
  seatIndex: number;
  /** Board corner 0..3 (top-left, top-right, bottom-right, bottom-left). */
  quadrant: number;
  /** Progress of the four tokens: -1 base, 0..51 track, 52..56 home column, 57 home. */
  tokens: number[];
  lastAction: string | null;
  home: number;
}

export interface LudoGameInfo {
  kind: 'ludo';
  phase: LudoPhase;
  gameNumber: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** Server clock so clients can count the turn timer down accurately. */
  serverNow: number;
  /** The roll waiting to be played, when the player must pick a token. */
  dice: number | null;
  /** The last roll, kept on screen between turns. */
  lastRoll: number | null;
  winnerUserId: number | null;
  legal: LudoLegalActions | null;
  players: LudoPlayerInfo[];
}

export interface DominoesTileInfo {
  id: number;
  a: number;
  b: number;
}

export interface DominoesChainInfo {
  tileId: number;
  left: number;
  right: number;
}

export interface DominoesPlayerInfo {
  userId: number;
  seatIndex: number;
  /**
   * How many tiles this player holds — never which ones, and never what they
   * are worth: a player's pip total is as private as their hand.
   */
  handCount: number;
  lastAction: string | null;
}

export interface DominoesScoreInfo {
  userId: number;
  pips: number;
}

export interface DominoesGameInfo {
  kind: 'dominoes';
  phase: DominoesPhase;
  gameNumber: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** Server clock so clients can count the turn timer down accurately. */
  serverNow: number;
  boneyardCount: number;
  /** The chain from left to right, every tile already oriented. */
  chain: DominoesChainInfo[];
  leftEnd: number | null;
  rightEnd: number | null;
  /** Only the viewer's own tiles. */
  hand: DominoesTileInfo[];
  legal: DominoesLegalActions | null;
  /** How the last round ended — drives the result copy in the room. */
  resultReason: 'hand' | 'blocked' | 'forfeit' | null;
  winnerUserIds: number[];
  scores: DominoesScoreInfo[];
  players: DominoesPlayerInfo[];
}

export interface ChessPlayerInfo {
  userId: number;
  seatIndex: number;
  color: ChessColor;
  lastAction: string | null;
}

export interface ChessGameInfo {
  kind: 'chess';
  phase: ChessPhase;
  gameNumber: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** Server clock so clients can count the turn timer down accurately. */
  serverNow: number;
  turn: ChessColor;
  /** 64 squares, index 0 = a8 ... 63 = h1; null on an empty square. */
  board: (ChessPiece | null)[];
  castling: ChessCastlingRights;
  enPassant: string | null;
  halfmoveClock: number;
  fullmoveNumber: number;
  /** The side to move is in check. */
  inCheck: boolean;
  /** The last move, kept on screen so both players see it. */
  lastMove: { from: string; to: string } | null;
  moves: ChessMoveRecord[];
  winnerUserId: number | null;
  result: ChessResult | null;
  legal: ChessLegalActions | null;
  players: ChessPlayerInfo[];
  /** The clock the table was created with, resolved to milliseconds. */
  timeControl: { id: string; initialMs: number; incrementMs: number };
  /** What each player has left in the bank, in milliseconds. */
  clocks: Record<ChessColor, number>;
  /** When the mover's clock started — clients extrapolate from `serverNow`. */
  turnStartedAt: number | null;
  /** The player with a standing draw offer, or null. */
  drawOffer: { userId: number; color: ChessColor } | null;
}

export interface UnoPlayerInfo {
  userId: number;
  seatIndex: number;
  /** How many cards this player holds — never which ones. */
  cardCount: number;
  lastAction: string | null;
  /** One card left and UNO was called. */
  saidUno: boolean;
  /** One card left without calling UNO — anyone may catch them. */
  pendingUno: boolean;
}

export interface UnoGameInfo {
  kind: 'uno';
  phase: UnoPhase;
  gameNumber: number;
  turnUserId: number | null;
  turnDeadline: number | null;
  /** Server clock so clients can count the turn timer down accurately. */
  serverNow: number;
  /** 1 = clockwise, -1 = counter-clockwise. */
  direction: 1 | -1;
  /** The colour that must currently be matched. */
  activeColor: UnoColor;
  /** Top of the discard pile — the card everyone plays against. */
  discardTop: string | null;
  /** Cards left in the draw pile (the discard pile recycles into it). */
  drawCount: number;
  /** Only the viewer's own hand is ever serialised to the browser. */
  hand: string[];
  /** A player with one card who has not called UNO yet. */
  pendingUno: { userId: number; deadline: number } | null;
  winnerUserId: number | null;
  /** Points the winner scored from the other hands in this round. */
  winnerPoints: number;
  /** Running match scores — first to 500 wins the match. */
  matchScores: Record<number, number>;
  /** The user who won the match (500+ points), if any. */
  matchWinnerUserId: number | null;
  legal: UnoLegalActions | null;
  players: UnoPlayerInfo[];
}

/** The game-specific half of a table payload — one shape per game slug. */
export type AnyTableGameInfo =
  | TableGameInfo
  | LudoGameInfo
  | DominoesGameInfo
  | ChessGameInfo
  | UnoGameInfo;

export interface TableSummary {
  id: number;
  name: string;
  maxSeats: number;
  entryFee: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  /** Chess only: the clock the creator picked, so the lobby can show it. */
  timeControl: string | null;
  /** Seconds per turn for non-chess games. */
  turnSeconds: number | null;
  creatorName: string;
  seatedCount: number;
  seatedUserIds: number[];
  createdAt: Date;
}

/** An open seat offer, as the invited friend sees it. */
export interface TableInviteInfo {
  id: number;
  tableId: number;
  tableName: string;
  gameSlug: string;
  gameName: string;
  inviterId: number;
  inviterName: string;
  seatedCount: number;
  maxSeats: number;
  entryFee: number | null;
  createdAt: Date;
}

/** An open invite on a table, as the invite dialog lists it. */
export interface PendingInviteInfo {
  id: number;
  inviteeId: number;
  createdAt: Date;
}

export interface TableDetails {
  id: number;
  name: string;
  maxSeats: number;
  entryFee: number | null;
  smallBlind: number | null;
  bigBlind: number | null;
  gameSlug: string;
  gameName: string;
  creatorName: string;
  seats: TableSeatInfo[];
  game: AnyTableGameInfo;
}

@Injectable()
export class TablesService {
  constructor(
    @InjectRepository(Table)
    private readonly tablesRepository: Repository<Table>,
    @InjectRepository(TablePlayer)
    private readonly tablePlayersRepository: Repository<TablePlayer>,
    @InjectRepository(Game)
    private readonly gamesRepository: Repository<Game>,
    @InjectRepository(TableInvite)
    private readonly tableInvitesRepository: Repository<TableInvite>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly friendsService: FriendsService,
    private readonly dataSource: DataSource,
    private readonly events: GameEventsService,
  ) {}

  async listByGameSlug(slug: string): Promise<TableSummary[]> {
    const game = await this.findGameOrFail(slug);
    const tables = await this.tablesRepository.find({
      where: { gameId: game.id },
      relations: { createdBy: true, players: true },
      order: { createdAt: 'DESC' },
    });

    return tables.map((table) => ({
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      // Chess tables carry their clock instead of blinds.
      timeControl:
        game.slug === 'chess'
          ? ((table.state as ChessState | null)?.timeControl ??
            DEFAULT_CHESS_TIME_CONTROL)
          : null,
      turnSeconds:
        game.slug === 'chess'
          ? null
          : (table.turnSeconds ?? this.defaultTurnMs(game.slug) / 1000),
      creatorName: table.createdBy.displayName,
      seatedCount: table.players.length,
      seatedUserIds: table.players.map((player) => player.userId),
      createdAt: table.createdAt,
    }));
  }

  async create(
    userId: number,
    slug: string,
    dto: CreateTableDto,
  ): Promise<TableDetails> {
    const game = await this.findGameOrFail(slug);
    if (game.status !== 'available') {
      throw new ConflictException(`${game.name} is not open for tables yet`);
    }

    const maxSeats = dto.maxSeats ?? game.maxSeats;
    if (maxSeats > game.maxSeats) {
      throw new BadRequestException(
        `${game.name} tables allow at most ${game.maxSeats} seats`,
      );
    }

    if (game.slug === 'chess' && dto.turnSeconds != null) {
      throw new BadRequestException('Chess uses timeControl for each player');
    }

    const smallBlind = dto.smallBlind ?? null;
    const bigBlind = dto.bigBlind ?? null;
    if (smallBlind != null && bigBlind != null && bigBlind < smallBlind) {
      throw new BadRequestException(
        'bigBlind must be greater than or equal to smallBlind',
      );
    }
    if (game.slug === 'poker' && dto.entryFee < (bigBlind ?? DEFAULT_BIG_BLIND)) {
      throw new BadRequestException('Poker buy-in must cover the big blind');
    }

    const creator = await this.usersRepository.findOneBy({ id: userId });
    if (!creator) {
      throw new NotFoundException('Account no longer exists');
    }
    const nameBase = tableNameBase(game.slug, creator.displayName);
    let table: Table | null = null;
    for (let attempt = 0; attempt < TABLE_NAME_ATTEMPTS; attempt++) {
      const nameCode = randomBytes(TABLE_NAME_CODE_BYTES).toString('base64url');
      const name = `${nameBase}-${nameCode}`;
      // Legacy tables have no code, so check their names before reserving ours.
      if (await this.tablesRepository.exists({ where: { name } })) continue;
      try {
        table = await this.dataSource.transaction(async (manager) => {
          const created = await manager.save(Table, manager.create(Table, {
            gameId: game.id,
            name,
            nameCode,
            maxSeats,
            entryFee: dto.entryFee,
            turnSeconds:
              game.slug === 'chess'
                ? null
                : (dto.turnSeconds ?? this.defaultTurnMs(game.slug) / 1000),
            smallBlind,
            bigBlind,
            // Chess tables carry their clock before the first action.
            state:
              game.slug === 'chess'
                ? createChessState(dto.timeControl ?? DEFAULT_CHESS_TIME_CONTROL)
                : null,
            createdBy: { id: userId },
          }));
          const seat = await manager.save(TablePlayer, manager.create(TablePlayer, {
            tableId: created.id,
            userId,
            seatIndex: 0,
          }));
          await this.chargeForSeat(manager, userId, dto.entryFee, seat.id);
          return created;
        });
        break;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    if (!table) {
      throw new ConflictException(
        'Could not generate a unique table name. Please try again.',
      );
    }

    this.events.table(game.slug, table.id);
    return this.getDetails(table.id, userId);
  }

  async getDetails(id: number, viewerUserId: number): Promise<TableDetails> {
    let table = await this.loadTable(id);

    // Polling clients drive turn timeouts forward even when nobody acts.
    const state = table.state;
    if (state && table.game.slug === 'ludo') {
      const ludo = state as LudoState;
      if (
        ludo.phase === 'playing' &&
        ludo.turnDeadline != null &&
        Date.now() >= ludo.turnDeadline
      ) {
        await this.mutateLudoState(id);
        table = await this.loadTable(id);
      }
    } else if (state && table.game.slug === 'dominoes') {
      const dominoes = state as DominoesState;
      if (
        dominoes.phase === 'playing' &&
        dominoes.turnDeadline != null &&
        Date.now() >= dominoes.turnDeadline
      ) {
        await this.mutateDominoesState(id);
        table = await this.loadTable(id);
      }
    } else if (state && table.game.slug === 'chess') {
      const chess = state as ChessState;
      if (
        chess.phase === 'playing' &&
        chess.turnDeadline != null &&
        Date.now() >= chess.turnDeadline
      ) {
        await this.mutateChessState(id);
        table = await this.loadTable(id);
      }
    } else if (state && table.game.slug === 'uno') {
      const uno = state as UnoState;
      const unoStale =
        uno.pendingUno != null && Date.now() >= uno.pendingUno.deadline;
      if (
        isUnoPlaying(uno) &&
        ((uno.turnDeadline != null && Date.now() >= uno.turnDeadline) ||
          unoStale)
      ) {
        await this.mutateUnoState(id);
        table = await this.loadTable(id);
      }
    } else if (
      state &&
      isBettingPhase(state as GameState) &&
      (state as GameState).turnDeadline != null &&
      Date.now() >= (state as GameState).turnDeadline!
    ) {
      await this.mutateState(id, (current) => tickTimeouts(current, Date.now()));
      table = await this.loadTable(id);
    }

    const seats = await this.tablePlayersRepository.find({
      where: { tableId: id },
      relations: { user: true },
      order: { seatIndex: 'ASC' },
    });

    return this.buildDetails(table, seats, viewerUserId);
  }

  async join(userId: number, tableId: number, confirmedEntryFee?: number): Promise<TableDetails> {
    const joined = await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) throw new NotFoundException('This table no longer exists');
      // Rejoining an existing seat never charges twice.
      const existing = await manager.findOneBy(TablePlayer, { tableId, userId });
      if (existing) return null;
      if (table.entryFee != null && confirmedEntryFee !== table.entryFee) {
        throw new BadRequestException('Confirm the current entry price before joining');
      }
      const game = await manager.findOneBy(Game, { id: table.gameId });
      if (game?.slug === 'poker' && table.state) {
        const state = table.state as GameState;
        normalizeState(state);
        if (state.players.some((player) => player.userId === userId)) {
          if (isBettingPhase(state)) {
            throw new ConflictException('Wait for this hand to finish before buying in again');
          }
          // A player who left mid-hand already cashed out their old stack.
          state.players = state.players.filter((player) => player.userId !== userId);
          state.ready = state.ready.filter((readyId) => readyId !== userId);
          await manager.update(Table, tableId, { state });
        }
      }

      const taken = await manager.findBy(TablePlayer, { tableId });
      if (taken.length >= table.maxSeats) {
        throw new ConflictException('This table is full');
      }
      const takenIndexes = new Set(taken.map((seat) => seat.seatIndex));
      let seatIndex = 0;
      while (takenIndexes.has(seatIndex)) seatIndex += 1;

      const seat = await manager.save(TablePlayer, manager.create(TablePlayer, {
        tableId, userId, seatIndex,
      }));
      if (table.entryFee) {
        await this.chargeForSeat(manager, userId, table.entryFee, seat.id);
      }
      return table.gameId;
    });

    if (joined) {
      const game = await this.gamesRepository.findOneBy({ id: joined });
      if (game) this.events.table(game.slug, tableId);
    }
    return this.getDetails(tableId, userId);
  }

  async leave(userId: number, tableId: number): Promise<void> {
    const slug = await this.dataSource.transaction(async (manager) => {
      // The slug decides which engine cleans up the state; load it before
      // taking the row lock (Postgres refuses FOR UPDATE on outer joins).
      const meta = await manager.findOne(Table, {
        where: { id: tableId },
        relations: { game: true },
      });
      if (!meta) {
        return;
      }
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) {
        return;
      }
      const seat = await manager.findOneBy(TablePlayer, { tableId, userId });
      if (!seat) {
        return;
      }
      const participantIds = (await manager.findBy(TablePlayer, { tableId }))
        .map((player) => player.userId);
      let pokerPayout = meta.game.slug === 'poker' ? (table.entryFee ?? 0) : 0;

      if (table.state) {
        const previousResult = completedGame(meta.game.slug, table.state);
        const now = Date.now();
        if (meta.game.slug === 'ludo') {
          const state = table.state as LudoState;
          tickLudo(state, now);
          leaveLudo(state, userId, now);
          table.state = state;
          await manager.update(Table, tableId, { state });
        } else if (meta.game.slug === 'dominoes') {
          const state = table.state as DominoesState;
          tickDominoes(state, now);
          leaveDominoes(state, userId, now);
          table.state = state;
          await manager.update(Table, tableId, { state });
        } else if (meta.game.slug === 'chess') {
          const state = table.state as ChessState;
          tickChess(state, now);
          leaveChess(state, userId);
          table.state = state;
          await manager.update(Table, tableId, { state });
        } else if (meta.game.slug === 'uno') {
          const state = table.state as UnoState;
          tickUno(state, now);
          leaveUno(state, userId, now);
          table.state = state;
          await manager.update(Table, tableId, { state });
        } else {
          const state = table.state as GameState;
          normalizeState(state);
          tickTimeouts(state, now);
          // Leaving mid-hand folds you — your committed chips stay in the pot.
          if (isBettingPhase(state)) {
            forceFold(state, userId, now);
          }
          if (table.entryFee != null) {
            pokerPayout = state.players.find((player) => player.userId === userId)?.stack ?? table.entryFee;
          }
          if (state.phase === 'waiting') {
            state.players = state.players.filter((p) => p.userId !== userId);
          }
          state.ready = state.ready.filter((id) => id !== userId);
          table.state = state;
          await manager.update(Table, tableId, { state });
        }
        const nextResult = completedGame(meta.game.slug, table.state);
        await this.saveCompletedGame(
          manager, table, meta.game.slug,
          nextResult && (!previousResult || nextResult.gameNumber !== previousResult.gameNumber)
            ? participantIds : [],
        );
      }

      if (pokerPayout > 0) {
        const user = await manager.findOne(User, {
          where: { id: userId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!user) throw new NotFoundException('Account no longer exists');
        if (user.balance > 2_147_483_647 - pokerPayout) {
          throw new BadRequestException('Poker payout would exceed the balance limit');
        }
        user.balance += pokerPayout;
        await manager.save(user);
        await manager.save(WalletEntry, manager.create(WalletEntry, {
          userId,
          amount: pokerPayout,
          kind: 'game_payout',
          reference: `seat:${seat.id}:payout`,
        }));
      }

      await manager.delete(TablePlayer, { id: seat.id });

      // Empty tables disappear — only real, seated people keep a table alive.
      const remaining = await manager.countBy(TablePlayer, { tableId });
      if (remaining === 0) {
        await manager.delete(Table, { id: tableId });
      }
      return meta.game.slug;
    });
    if (slug) this.events.table(slug, tableId);
  }

  /**
   * Offers a friend a seat at this table. You must be sitting there yourself,
   * and only friends can be invited — that is the whole point of the list.
   */
  async inviteFriend(
    viewerId: number,
    tableId: number,
    inviteeId: number,
  ): Promise<PendingInviteInfo[]> {
    const table = await this.tablesRepository.findOneBy({ id: tableId });
    if (!table) {
      throw new NotFoundException('This table no longer exists');
    }

    const hostSeat = await this.tablePlayersRepository.findOneBy({
      tableId,
      userId: viewerId,
    });
    if (!hostSeat) {
      throw new ForbiddenException('Only players at the table can invite');
    }

    const seatedCount = await this.tablePlayersRepository.countBy({ tableId });
    if (seatedCount >= table.maxSeats) {
      throw new ConflictException('This table is full');
    }

    const invitee = await this.usersRepository.findOneBy({ id: inviteeId });
    if (!invitee) {
      throw new NotFoundException('That player no longer exists');
    }
    if (!(await this.friendsService.areFriends(viewerId, inviteeId))) {
      throw new BadRequestException('You can only invite friends');
    }

    const seated = await this.tablePlayersRepository.findOneBy({
      tableId,
      userId: inviteeId,
    });
    if (seated) {
      throw new ConflictException('They are already at this table');
    }

    try {
      await this.tableInvitesRepository.save(
        this.tableInvitesRepository.create({
          tableId,
          inviterId: viewerId,
          inviteeId,
        }),
      );
    } catch (error) {
      // Tapping invite twice races past the lookup; the unique pair is the gate.
      if (isUniqueViolation(error)) {
        throw new ConflictException('You already invited them');
      }
      throw error;
    }

    this.events.invite(inviteeId);
    return this.listTableInvites(viewerId, tableId);
  }

  /** The open invites on a table, for the invite dialog's "Invited" state. */
  async listTableInvites(
    viewerId: number,
    tableId: number,
  ): Promise<PendingInviteInfo[]> {
    const seat = await this.tablePlayersRepository.findOneBy({
      tableId,
      userId: viewerId,
    });
    if (!seat) {
      throw new ForbiddenException('Only players at the table can invite');
    }

    const invites = await this.tableInvitesRepository.find({
      where: { tableId },
      order: { createdAt: 'DESC' },
    });

    return invites.map((invite) => ({
      id: invite.id,
      inviteeId: invite.inviteeId,
      createdAt: invite.createdAt,
    }));
  }

  /** Every open invite addressed to the viewer, newest first. */
  async listInvites(viewerId: number): Promise<TableInviteInfo[]> {
    const invites = await this.tableInvitesRepository.find({
      where: { inviteeId: viewerId },
      relations: { table: { game: true }, inviter: true },
      order: { createdAt: 'DESC' },
    });
    if (!invites.length) {
      return [];
    }

    // An invite to a table you already sit at is stale — drop it for good.
    const mySeats = await this.tablePlayersRepository.findBy({
      userId: viewerId,
    });
    const myTableIds = new Set(mySeats.map((seat) => seat.tableId));
    const live = invites.filter((invite) => !myTableIds.has(invite.tableId));
    const staleIds = invites
      .filter((invite) => myTableIds.has(invite.tableId))
      .map((invite) => invite.id);
    if (staleIds.length) {
      await this.tableInvitesRepository.delete({ id: In(staleIds) });
    }
    if (!live.length) {
      return [];
    }

    const countRows = await this.tablePlayersRepository
      .createQueryBuilder('player')
      .select('player.tableId', 'tableId')
      .addSelect('COUNT(*)', 'count')
      .where('player.tableId IN (:...tableIds)', {
        tableIds: live.map((invite) => invite.tableId),
      })
      .groupBy('player.tableId')
      .getRawMany<{ tableId: number; count: string }>();
    const seatedCounts = new Map(
      countRows.map((row) => [Number(row.tableId), Number(row.count)]),
    );

    return live.map((invite) => ({
      id: invite.id,
      tableId: invite.tableId,
      tableName: invite.table.name,
      gameSlug: invite.table.game.slug,
      gameName: invite.table.game.name,
      inviterId: invite.inviter.id,
      inviterName: invite.inviter.displayName,
      seatedCount: seatedCounts.get(invite.tableId) ?? 1,
      maxSeats: invite.table.maxSeats,
      entryFee: invite.table.entryFee,
      createdAt: invite.createdAt,
    }));
  }

  /** Accepting an invite seats you and closes it. Joining is idempotent. */
  async acceptInvite(
    viewerId: number,
    inviteId: number,
    confirmedEntryFee?: number,
  ): Promise<TableDetails> {
    const invite = await this.tableInvitesRepository.findOneBy({
      id: inviteId,
      inviteeId: viewerId,
    });
    if (!invite) {
      throw new NotFoundException('This invitation is no longer open');
    }

    const details = await this.join(viewerId, invite.tableId, confirmedEntryFee);
    await this.tableInvitesRepository.delete({ id: invite.id });

    this.events.invite(viewerId);

    return details;
  }

  /** Declining closes the invite — the inviter may ask again later. */
  async declineInvite(viewerId: number, inviteId: number): Promise<void> {
    const result = await this.tableInvitesRepository.delete({
      id: inviteId,
      inviteeId: viewerId,
    });
    if (!result.affected) {
      throw new NotFoundException('This invitation is no longer open');
    }
    this.events.invite(viewerId);
  }

  /**
   * Ready up, or make a move. Every game runs on the same table system: the
   * table's game slug picks the engine that the action is handed to.
   */
  async act(
    userId: number,
    tableId: number,
    dto: TableActionDto,
  ): Promise<TableDetails> {
    const slug = await this.dataSource.transaction(async (manager) => {
      const meta = await manager.findOne(Table, {
        where: { id: tableId },
        relations: { game: true },
      });
      if (!meta) {
        throw new NotFoundException('This table no longer exists');
      }
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) {
        throw new NotFoundException('This table no longer exists');
      }

      const seats = await manager.find(TablePlayer, {
        where: { tableId },
        order: { seatIndex: 'ASC' },
      });
      const seated = seats.some((seat) => seat.userId === userId);
      if (!seated) {
        throw new BadRequestException('Take a seat before acting');
      }

      const now = Date.now();
      if (meta.game.slug === 'ludo') {
        this.actLudo(table, seats, userId, dto, now);
      } else if (meta.game.slug === 'dominoes') {
        this.actDominoes(table, seats, userId, dto, now);
      } else if (meta.game.slug === 'chess') {
        this.actChess(table, seats, userId, dto, now);
      } else if (meta.game.slug === 'uno') {
        this.actUno(table, seats, userId, dto, now);
      } else {
        this.actPoker(table, seats, userId, dto, now);
      }

      await manager.update(Table, tableId, { state: table.state });
      await this.saveCompletedGame(manager, table, meta.game.slug);
      return meta.game.slug;
    });

    this.events.table(slug, tableId);
    return this.getDetails(tableId, userId);
  }

  private async saveCompletedGame(
    manager: EntityManager,
    table: Table,
    slug: string,
    fallbackParticipantIds: number[] = [],
  ): Promise<void> {
    const result = completedGame(slug, table.state);
    if (!result || result.gameNumber < 1) return;
    const participantIds = [...new Set([...result.participantIds, ...fallbackParticipantIds])];
    if (participantIds.length < 2) return;
    const people = await manager.findBy(User, { id: In(participantIds) });
    const names = new Map(people.map((person) => [person.id, person.displayName]));
    await manager
      .createQueryBuilder()
      .insert()
      .into(GameResult)
      .values(participantIds.map((userId) => ({
        userId,
        tableId: table.id,
        tableName: table.name,
        gameSlug: slug,
        gameNumber: result.gameNumber,
        outcome: result.draw ? 'draw' as const : result.winnerIds.includes(userId) ? 'won' as const : 'lost' as const,
        summary: result.summary,
        opponentNames: participantIds.filter((id) => id !== userId).map((id) => names.get(id) ?? 'Player'),
      })))
      .orIgnore()
      .execute();
  }

  private actPoker(
    table: Table,
    seats: TablePlayer[],
    userId: number,
    dto: TableActionDto,
    now: number,
  ): void {
    const state = (table.state as GameState | null) ?? createState();
    normalizeState(state);
    tickTimeouts(state, now);

    if (state.phase === 'waiting') {
      // Between hands only seated players stay at the table.
      const seatedIds = new Set(seats.map((seat) => seat.userId));
      state.players = state.players.filter((p) => seatedIds.has(p.userId));
      state.ready = state.ready.filter((id) => seatedIds.has(id));
    }

    if (dto.type === 'ready') {
      if (isBettingPhase(state)) {
        throw new BadRequestException('A hand is already running');
      }
      if (table.entryFee != null && state.players.some((player) => player.userId === userId && player.stack <= 0)) {
        throw new BadRequestException('No chips left. Leave and rejoin to buy in again');
      }
      markReady(state, userId);
      const blinds = this.blindsFor(table);
      if (everyoneReady(state, seats.map((seat) => seat.userId))) {
        try {
          startHand(state, {
            seats: seats.map((seat) => ({
              userId: seat.userId,
              seatIndex: seat.seatIndex,
            })),
            smallBlind: blinds.smallBlind,
            bigBlind: blinds.bigBlind,
            buyIn: blinds.buyIn,
            turnMs: this.turnMsFor(table, 'poker'),
            now,
          });
        } catch (error) {
          throw new BadRequestException(this.errorMessage(error));
        }
      }
    } else if (
      dto.type === 'fold' ||
      dto.type === 'check' ||
      dto.type === 'call' ||
      dto.type === 'raise' ||
      dto.type === 'allin'
    ) {
      try {
        applyAction(state, userId, { type: dto.type, amount: dto.amount }, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else {
      throw new BadRequestException('That action is not part of poker');
    }

    table.state = state;
  }

  private actLudo(
    table: Table,
    seats: TablePlayer[],
    userId: number,
    dto: TableActionDto,
    now: number,
  ): void {
    const state = (table.state as LudoState | null) ?? createLudoState();
    tickLudo(state, now);

    if (state.phase === 'waiting') {
      // Between games only seated players stay at the table.
      const seatedIds = new Set(seats.map((seat) => seat.userId));
      state.players = state.players.filter((p) => seatedIds.has(p.userId));
      state.ready = state.ready.filter((id) => seatedIds.has(id));
    }

    if (dto.type === 'ready') {
      try {
        markLudoReady(state, userId);
        if (everyoneLudoReady(state, seats.map((seat) => seat.userId))) {
          startLudo(state, {
            seats: seats.map((seat) => ({
              userId: seat.userId,
              seatIndex: seat.seatIndex,
            })),
            turnMs: this.turnMsFor(table, 'ludo'),
            now,
          });
        }
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'roll') {
      try {
        rollLudo(state, userId, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'move') {
      if (dto.tokenId == null) {
        throw new BadRequestException('Pick a token to move');
      }
      try {
        moveLudo(state, userId, dto.tokenId, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else {
      throw new BadRequestException('That action is not part of Ludo');
    }

    table.state = state;
  }

  private actDominoes(
    table: Table,
    seats: TablePlayer[],
    userId: number,
    dto: TableActionDto,
    now: number,
  ): void {
    const state = (table.state as DominoesState | null) ?? createDominoesState();
    tickDominoes(state, now);

    if (state.phase === 'waiting') {
      // Between rounds only seated players stay at the table.
      const seatedIds = new Set(seats.map((seat) => seat.userId));
      state.players = state.players.filter((p) => seatedIds.has(p.userId));
      state.ready = state.ready.filter((id) => seatedIds.has(id));
    }

    if (dto.type === 'ready') {
      try {
        markDominoesReady(state, userId);
        if (everyoneDominoesReady(state, seats.map((seat) => seat.userId))) {
          startDominoes(state, {
            seats: seats.map((seat) => ({
              userId: seat.userId,
              seatIndex: seat.seatIndex,
            })),
            turnMs: this.turnMsFor(table, 'dominoes'),
            now,
          });
        }
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'play') {
      if (dto.tileId == null) {
        throw new BadRequestException('Pick a tile to play');
      }
      try {
        playDominoes(
          state,
          userId,
          dto.tileId,
          dto.end as DominoesEnd | undefined,
          now,
        );
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'draw') {
      try {
        drawDominoes(state, userId, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'pass') {
      try {
        passDominoes(state, userId, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else {
      throw new BadRequestException('That action is not part of Dominoes');
    }

    table.state = state;
  }

  private actChess(
    table: Table,
    seats: TablePlayer[],
    userId: number,
    dto: TableActionDto,
    now: number,
  ): void {
    const state = (table.state as ChessState | null) ?? createChessState();
    normalizeChessState(state);
    tickChess(state, now);

    if (state.phase === 'waiting') {
      // Between games only seated players stay at the table.
      const seatedIds = new Set(seats.map((seat) => seat.userId));
      state.players = state.players.filter((p) => seatedIds.has(p.userId));
      state.ready = state.ready.filter((id) => seatedIds.has(id));
    }

    if (dto.type === 'ready') {
      try {
        markChessReady(state, userId);
        if (everyoneChessReady(state, seats.map((seat) => seat.userId))) {
          startChess(state, {
            seats: seats.map((seat) => ({
              userId: seat.userId,
              seatIndex: seat.seatIndex,
            })),
            timeControl: state.timeControl,
            now,
          });
        }
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'move') {
      if (dto.from == null || dto.to == null) {
        throw new BadRequestException('Pick a square to move from and to');
      }
      try {
        playChessMove(state, userId, dto.from, dto.to, dto.promotion ?? null, now);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'resign') {
      try {
        resignChess(state, userId);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'offer_draw') {
      try {
        offerChessDraw(state, userId);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'accept_draw') {
      try {
        acceptChessDraw(state, userId);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (dto.type === 'decline_draw') {
      try {
        declineChessDraw(state, userId);
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else {
      throw new BadRequestException('That action is not part of Chess');
    }

    table.state = state;
  }

  private actUno(
    table: Table,
    seats: TablePlayer[],
    userId: number,
    dto: TableActionDto,
    now: number,
  ): void {
    const state = (table.state as UnoState | null) ?? createUnoState();
    tickUno(state, now);

    if (state.phase === 'waiting') {
      // Between games only seated players stay at the table.
      const seatedIds = new Set(seats.map((seat) => seat.userId));
      state.players = state.players.filter((p) => seatedIds.has(p.userId));
      state.ready = state.ready.filter((id) => seatedIds.has(id));
    }

    if (dto.type === 'ready') {
      try {
        markUnoReady(state, userId);
        if (everyoneUnoReady(state, seats.map((seat) => seat.userId))) {
          startUno(state, {
            seats: seats.map((seat) => ({
              userId: seat.userId,
              seatIndex: seat.seatIndex,
            })),
            turnMs: this.turnMsFor(table, 'uno'),
            now,
          });
        }
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else if (
      dto.type === 'play' ||
      dto.type === 'draw' ||
      dto.type === 'pass' ||
      dto.type === 'call_uno' ||
      dto.type === 'catch_uno' ||
      dto.type === 'challenge_wf4'
    ) {
      try {
        applyUnoAction(
          state,
          userId,
          { type: dto.type, card: dto.card, color: dto.color, accept: dto.accept },
          now,
        );
      } catch (error) {
        throw new BadRequestException(this.errorMessage(error));
      }
    } else {
      throw new BadRequestException('That action is not part of Uno');
    }

    table.state = state;
  }

  private async mutateState(
    tableId: number,
    mutate: (state: GameState) => void,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table) {
        return;
      }
      const state = (table.state as GameState | null) ?? createState();
      normalizeState(state);
      mutate(state);
      await manager.update(Table, tableId, { state });
      table.state = state;
      await this.saveCompletedGame(manager, table, 'poker');
    });
    this.events.table('poker', tableId);
  }

  /** Plays one timeout step for a Ludo game whose clock ran out. */
  private async mutateLudoState(tableId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table || !table.state) {
        return;
      }
      const state = table.state as LudoState;
      tickLudo(state, Date.now());
      await manager.update(Table, tableId, { state });
      await this.saveCompletedGame(manager, table, 'ludo');
    });
    this.events.table('ludo', tableId);
  }

  /** Plays one timeout step for a Dominoes round whose clock ran out. */
  private async mutateDominoesState(tableId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table || !table.state) {
        return;
      }
      const state = table.state as DominoesState;
      tickDominoes(state, Date.now());
      await manager.update(Table, tableId, { state });
      await this.saveCompletedGame(manager, table, 'dominoes');
    });
    this.events.table('dominoes', tableId);
  }

  /** Ends a chess game whose mover's clock ran out. */
  private async mutateChessState(tableId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table || !table.state) {
        return;
      }
      const state = table.state as ChessState;
      normalizeChessState(state);
      tickChess(state, Date.now());
      await manager.update(Table, tableId, { state });
      await this.saveCompletedGame(manager, table, 'chess');
    });
    this.events.table('chess', tableId);
  }

  /** Plays one timeout step for an Uno game whose clock ran out. */
  private async mutateUnoState(tableId: number): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const table = await manager.findOne(Table, {
        where: { id: tableId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!table || !table.state) {
        return;
      }
      const state = table.state as UnoState;
      tickUno(state, Date.now());
      await manager.update(Table, tableId, { state });
      await this.saveCompletedGame(manager, table, 'uno');
    });
    this.events.table('uno', tableId);
  }

  private buildDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    if (table.game.slug === 'ludo') {
      return this.buildLudoDetails(table, seats, viewerUserId);
    }
    if (table.game.slug === 'dominoes') {
      return this.buildDominoesDetails(table, seats, viewerUserId);
    }
    if (table.game.slug === 'chess') {
      return this.buildChessDetails(table, seats, viewerUserId);
    }
    if (table.game.slug === 'uno') {
      return this.buildUnoDetails(table, seats, viewerUserId);
    }
    return this.buildPokerDetails(table, seats, viewerUserId);
  }

  private buildPokerDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    const state = table.state as GameState | null;
    const blinds = this.blindsFor(table);

    let legal: LegalActions | null = null;
    if (state) {
      const viewer = state.players.find((p) => p.userId === viewerUserId);
      if (viewer) {
        legal = legalActionsFor(state, viewer);
      }
    }

    const game: TableGameInfo = {
      kind: 'poker',
      phase: state?.phase ?? 'waiting',
      handNumber: state?.handNumber ?? 0,
      pot: state ? potTotal(state) : 0,
      pots: state ? potsFor(state) : [],
      potAwards: state?.lastResult?.pots ?? null,
      community: state?.community ?? [],
      currentBet: state?.currentBet ?? 0,
      dealerSeat: state?.dealerSeat ?? null,
      smallBlindSeat: state?.smallBlindSeat ?? null,
      bigBlindSeat: state?.bigBlindSeat ?? null,
      turnUserId: state?.turnUserId ?? null,
      turnDeadline: state?.turnDeadline ?? null,
      serverNow: Date.now(),
      winners: state?.lastResult?.winners ?? null,
      legal,
    };

    return {
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      gameSlug: table.game.slug,
      gameName: table.game.name,
      creatorName: table.createdBy.displayName,
      seats: seats.map((seat) => {
        const player = state?.players.find((p) => p.userId === seat.userId);
        const ready = state?.ready.includes(seat.userId) ?? false;
        return {
          seatIndex: seat.seatIndex,
          userId: seat.userId,
          displayName: seat.user.displayName,
          stack: player?.stack ?? blinds.buyIn,
          bet: player?.bet ?? 0,
          folded: player?.folded ?? false,
          allIn: player?.allIn ?? false,
          ready,
          status: seatStatus(seat.user.lastSeenAt, {
            ready,
            phase: game.phase,
            isViewer: seat.userId === viewerUserId,
          }),
          lastAction: player?.lastAction ?? null,
          cards:
            player &&
            player.hole.length > 0 &&
            (player.userId === viewerUserId || player.revealed)
              ? player.hole
              : null,
        };
      }),
      game,
    };
  }

  private buildLudoDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    const state = (table.state as LudoState | null) ?? null;

    const game: LudoGameInfo = {
      kind: 'ludo',
      phase: state?.phase ?? 'waiting',
      gameNumber: state?.gameNumber ?? 0,
      turnUserId: state?.turnUserId ?? null,
      turnDeadline: state?.turnDeadline ?? null,
      serverNow: Date.now(),
      dice: state?.dice ?? null,
      lastRoll: state?.lastRoll ?? null,
      winnerUserId: state?.lastResult?.winnerUserId ?? null,
      legal: state && isLudoPlaying(state) ? legalLudoActions(state, viewerUserId) : null,
      players: (state?.players ?? []).map((player) => ({
        userId: player.userId,
        seatIndex: player.seatIndex,
        quadrant: player.quadrant,
        tokens: player.tokens.map((token) => token.steps),
        lastAction: player.lastAction,
        home: homeCount(player),
      })),
    };

    return {
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      gameSlug: table.game.slug,
      gameName: table.game.name,
      creatorName: table.createdBy.displayName,
      seats: seats.map((seat) => {
        const player = state?.players.find((p) => p.userId === seat.userId);
        const ready = state?.ready.includes(seat.userId) ?? false;
        return {
          seatIndex: seat.seatIndex,
          userId: seat.userId,
          displayName: seat.user.displayName,
          // Ludo has no chips — the same seat shape carries the ready flag.
          stack: 0,
          bet: 0,
          folded: false,
          allIn: false,
          ready,
          status: seatStatus(seat.user.lastSeenAt, {
            ready,
            phase: game.phase,
            isViewer: seat.userId === viewerUserId,
          }),
          lastAction: player?.lastAction ?? null,
          cards: null,
        };
      }),
      game,
    };
  }

  private buildDominoesDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    const state = (table.state as DominoesState | null) ?? null;
    const viewer = state?.players.find((player) => player.userId === viewerUserId);
    const chain = state?.chain ?? [];

    const game: DominoesGameInfo = {
      kind: 'dominoes',
      phase: state?.phase ?? 'waiting',
      gameNumber: state?.gameNumber ?? 0,
      turnUserId: state?.turnUserId ?? null,
      turnDeadline: state?.turnDeadline ?? null,
      serverNow: Date.now(),
      boneyardCount: state?.boneyard.length ?? 0,
      chain: chain.map((tile) => ({
        tileId: tile.tileId,
        left: tile.left,
        right: tile.right,
      })),
      leftEnd: chain[0]?.left ?? null,
      rightEnd: chain[chain.length - 1]?.right ?? null,
      // Only the viewer's tiles are ever serialised to the browser.
      hand: (viewer?.hand ?? []).map((id) => {
        const tile = dominoesTile(id);
        return { id: tile.id, a: tile.a, b: tile.b };
      }),
      legal:
        state && isDominoesPlaying(state)
          ? legalDominoesActions(state, viewerUserId)
          : null,
      resultReason: state?.lastResult?.reason ?? null,
      winnerUserIds: state?.lastResult?.winnerUserIds ?? [],
      scores: state?.lastResult?.scores ?? [],
      players: (state?.players ?? []).map((player) => ({
        userId: player.userId,
        seatIndex: player.seatIndex,
        handCount: player.hand.length,
        lastAction: player.lastAction,
      })),
    };

    return {
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      gameSlug: table.game.slug,
      gameName: table.game.name,
      creatorName: table.createdBy.displayName,
      seats: seats.map((seat) => {
        const player = state?.players.find((p) => p.userId === seat.userId);
        const ready = state?.ready.includes(seat.userId) ?? false;
        return {
          seatIndex: seat.seatIndex,
          userId: seat.userId,
          displayName: seat.user.displayName,
          // Dominoes has no chips — the same seat shape carries ready state.
          stack: 0,
          bet: 0,
          folded: false,
          allIn: false,
          ready,
          status: seatStatus(seat.user.lastSeenAt, {
            ready,
            phase: game.phase,
            isViewer: seat.userId === viewerUserId,
          }),
          lastAction: player?.lastAction ?? null,
          cards: null,
        };
      }),
      game,
    };
  }

  private buildChessDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    const state = (table.state as ChessState | null) ?? null;
    const lastMove = state?.moves.at(-1) ?? null;
    const castling: ChessCastlingRights = state?.castling ?? {
      wK: true,
      wQ: true,
      bK: true,
      bQ: true,
    };
    const control = findChessTimeControl(state?.timeControl);
    const clocks = state?.clocks ?? {
      w: control.initialMs,
      b: control.initialMs,
    };
    const drawOfferUserId = state?.drawOffer ?? null;
    const drawOfferColor =
      drawOfferUserId == null
        ? null
        : (state?.players.find((player) => player.userId === drawOfferUserId)
            ?.color ?? null);

    const game: ChessGameInfo = {
      kind: 'chess',
      phase: state?.phase ?? 'waiting',
      gameNumber: state?.gameNumber ?? 0,
      turnUserId: state?.turnUserId ?? null,
      turnDeadline: state?.turnDeadline ?? null,
      serverNow: Date.now(),
      turn: state?.turn ?? 'w',
      // Before the first kickoff the waiting table still shows the start position.
      board: state?.board ?? initialChessBoard(),
      castling,
      enPassant: state?.enPassant ?? null,
      halfmoveClock: state?.halfmoveClock ?? 0,
      fullmoveNumber: state?.fullmoveNumber ?? 1,
      inCheck: state ? isInCheck(state.board, state.turn) : false,
      lastMove: lastMove ? { from: lastMove.from, to: lastMove.to } : null,
      moves: state?.moves ?? [],
      winnerUserId: state?.lastResult?.winnerUserId ?? null,
      result: state?.lastResult ?? null,
      legal:
        state && isChessPlaying(state)
          ? legalChessActions(state, viewerUserId)
          : null,
      players: (state?.players ?? []).map((player) => ({
        userId: player.userId,
        seatIndex: player.seatIndex,
        color: player.color,
        lastAction: player.lastAction,
      })),
      timeControl: {
        id: control.id,
        initialMs: control.initialMs,
        incrementMs: control.incrementMs,
      },
      clocks,
      turnStartedAt: state?.turnStartedAt ?? null,
      drawOffer:
        drawOfferUserId != null && drawOfferColor != null
          ? { userId: drawOfferUserId, color: drawOfferColor }
          : null,
    };

    return {
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      gameSlug: table.game.slug,
      gameName: table.game.name,
      creatorName: table.createdBy.displayName,
      seats: seats.map((seat) => {
        const player = state?.players.find((p) => p.userId === seat.userId);
        const ready = state?.ready.includes(seat.userId) ?? false;
        return {
          seatIndex: seat.seatIndex,
          userId: seat.userId,
          displayName: seat.user.displayName,
          // Chess has no chips — the same seat shape carries ready state.
          stack: 0,
          bet: 0,
          folded: false,
          allIn: false,
          ready,
          status: seatStatus(seat.user.lastSeenAt, {
            ready,
            phase: game.phase,
            isViewer: seat.userId === viewerUserId,
          }),
          lastAction: player?.lastAction ?? null,
          cards: null,
        };
      }),
      game,
    };
  }

  private buildUnoDetails(
    table: Table,
    seats: TablePlayer[],
    viewerUserId: number,
  ): TableDetails {
    const state = (table.state as UnoState | null) ?? null;

    const game: UnoGameInfo = {
      kind: 'uno',
      phase: state?.phase ?? 'waiting',
      gameNumber: state?.gameNumber ?? 0,
      turnUserId: state?.turnUserId ?? null,
      turnDeadline: state?.turnDeadline ?? null,
      serverNow: Date.now(),
      direction: state?.direction ?? 1,
      activeColor: state?.activeColor ?? 'R',
      discardTop: state ? topDiscard(state) : null,
      drawCount: state?.drawPile.length ?? 0,
      // Only the viewer's own hand is ever serialised to the browser.
      hand: state?.players.find((p) => p.userId === viewerUserId)?.hand ?? [],
      pendingUno: state?.pendingUno ?? null,
      winnerUserId: state?.lastResult?.winnerUserId ?? null,
      winnerPoints: state?.lastResult?.points ?? 0,
      matchScores: state?.matchScores ?? {},
      matchWinnerUserId: state?.phase === 'finished' && state?.matchScores
        ? Object.entries(state.matchScores).find(([, score]) => score >= 500)?.[0]
          ? Number(Object.entries(state.matchScores).find(([, score]) => score >= 500)?.[0])
          : null
        : null,
      legal:
        state && isUnoPlaying(state)
          ? legalUnoActions(state, viewerUserId)
          : null,
      players: (state?.players ?? []).map((player) => ({
        userId: player.userId,
        seatIndex: player.seatIndex,
        cardCount: player.hand.length,
        lastAction: player.lastAction,
        saidUno: player.saidUno,
        pendingUno: state?.pendingUno?.userId === player.userId,
      })),
    };

    return {
      id: table.id,
      name: table.name,
      maxSeats: table.maxSeats,
      entryFee: table.entryFee,
      smallBlind: table.smallBlind,
      bigBlind: table.bigBlind,
      gameSlug: table.game.slug,
      gameName: table.game.name,
      creatorName: table.createdBy.displayName,
      seats: seats.map((seat) => {
        const player = state?.players.find((p) => p.userId === seat.userId);
        const ready = state?.ready.includes(seat.userId) ?? false;
        return {
          seatIndex: seat.seatIndex,
          userId: seat.userId,
          displayName: seat.user.displayName,
          // Uno has no chips — the same seat shape carries ready state.
          stack: 0,
          bet: 0,
          folded: false,
          allIn: false,
          ready,
          status: seatStatus(seat.user.lastSeenAt, {
            ready,
            phase: game.phase,
            isViewer: seat.userId === viewerUserId,
          }),
          lastAction: player?.lastAction ?? null,
          cards: null,
        };
      }),
      game,
    };
  }

  private async loadTable(id: number): Promise<Table> {
    const table = await this.tablesRepository.findOne({
      where: { id },
      relations: { game: true, createdBy: true },
    });
    if (!table) {
      throw new NotFoundException('This table no longer exists');
    }
    return table;
  }

  private defaultTurnMs(slug: string): number {
    if (slug === 'ludo') return LUDO_TURN_MS;
    if (slug === 'dominoes') return DOMINOES_TURN_MS;
    if (slug === 'uno') return UNO_TURN_MS;
    return TURN_MS;
  }

  private turnMsFor(table: Table, slug: string): number {
    return table.turnSeconds != null
      ? table.turnSeconds * 1000
      : this.defaultTurnMs(slug);
  }

  private blindsFor(table: Table): {
    smallBlind: number;
    bigBlind: number;
    buyIn: number;
  } {
    const bigBlind = Math.max(1, table.bigBlind ?? DEFAULT_BIG_BLIND);
    const smallBlind = Math.min(
      Math.max(1, table.smallBlind ?? Math.floor(bigBlind / 2)),
      bigBlind,
    );
    return {
      smallBlind,
      bigBlind,
      buyIn: table.entryFee ?? bigBlind * BIG_BLINDS_PER_BUY_IN,
    };
  }

  private async chargeForSeat(
    manager: EntityManager,
    userId: number,
    amount: number,
    seatId: number,
  ): Promise<void> {
    const user = await manager.findOne(User, {
      where: { id: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!user) throw new NotFoundException('Account no longer exists');
    if (user.balance < amount) {
      throw new BadRequestException('Not enough credits to enter this table');
    }
    user.balance -= amount;
    await manager.save(user);
    await manager.save(WalletEntry, manager.create(WalletEntry, {
      userId,
      amount: -amount,
      kind: 'game_stake',
      reference: `seat:${seatId}:stake`,
    }));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'That action is not allowed';
  }

  private async findGameOrFail(slug: string): Promise<Game> {
    const game = await this.gamesRepository.findOneBy({ slug });
    if (!game) {
      throw new NotFoundException(`Game "${slug}" not found`);
    }
    return game;
  }
}
