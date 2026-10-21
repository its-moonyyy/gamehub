import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

export type WalletEntryKind = 'admin_credit' | 'game_stake' | 'game_payout';

/** Immutable balance change. A reference makes game charges idempotent. */
@Entity('wallet_entries')
@Index(['userId', 'createdAt'])
export class WalletEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'integer' })
  amount: number;

  @Column({ type: 'varchar', length: 20 })
  kind: WalletEntryKind;

  @Column({ type: 'varchar', length: 100, nullable: true, unique: true })
  reference: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
