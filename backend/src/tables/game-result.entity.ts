import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/** A player's permanent result, independent of the lifetime of the table. */
@Entity('game_results')
@Unique(['userId', 'tableId', 'gameNumber'])
@Index(['userId', 'finishedAt'])
export class GameResult {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  tableId: number;

  @Column({ length: 40 })
  tableName: string;

  @Column({ length: 30 })
  gameSlug: string;

  @Column({ type: 'integer' })
  gameNumber: number;

  @Column({ type: 'varchar', length: 8 })
  outcome: 'won' | 'lost' | 'draw';

  @Column({ type: 'varchar', length: 120 })
  summary: string;

  @Column({ type: 'jsonb' })
  opponentNames: string[];

  @CreateDateColumn()
  finishedAt: Date;
}
