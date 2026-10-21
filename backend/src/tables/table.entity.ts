import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Game } from '../games/game.entity.js';
import type { ChessState } from '../chess/chess-engine.js';
import type { DominoesState } from '../dominoes/dominoes-engine.js';
import type { LudoState } from '../ludo/ludo-engine.js';
import type { GameState } from '../poker/poker-engine.js';
import type { UnoState } from '../uno/uno-engine.js';
import { User } from '../users/user.entity.js';
import { TablePlayer } from './table-player.entity.js';

/** What a table's jsonb column holds — one game engine per game slug. */
export type TableGameState =
  | GameState
  | LudoState
  | DominoesState
  | ChessState
  | UnoState;

@Entity('tables')
export class Table {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  gameId: number;

  @ManyToOne(() => Game, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gameId' })
  game: Game;

  @Column({ length: 40 })
  name: string;

  /** Unique for generated names; null on tables created before automatic naming. */
  @Column({ type: 'varchar', length: 8, unique: true, nullable: true })
  nameCode: string | null;

  @Column({ type: 'integer' })
  maxSeats: number;

  /** Price of a seat in cents; null means a legacy free table. */
  @Column({ type: 'integer', nullable: true })
  entryFee: number | null;

  /** Per-turn timer for non-chess games; null on legacy and chess tables. */
  @Column({ type: 'integer', nullable: true })
  turnSeconds: number | null;

  /** Blinds in cents — null for games without stakes (e.g. Ludo). */
  @Column({ type: 'integer', nullable: true })
  smallBlind: number | null;

  @Column({ type: 'integer', nullable: true })
  bigBlind: number | null;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  createdBy: User;

  @OneToMany(() => TablePlayer, (player) => player.table)
  players: TablePlayer[];

  /**
   * Server-side game state (decks, stacks, dice, tokens). The API never sends
   * this raw — it is masked per viewer before it leaves the server.
   */
  @Column({ type: 'jsonb', nullable: true })
  state: TableGameState | null;

  @CreateDateColumn()
  createdAt: Date;
}
