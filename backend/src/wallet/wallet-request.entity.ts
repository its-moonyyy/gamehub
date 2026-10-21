import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity.js';

export type WalletRequestKind = 'deposit' | 'withdrawal';
export type WalletRequestStatus = 'pending' | 'accepted' | 'declined';

@Entity('wallet_requests')
@Index(['status', 'createdAt'])
export class WalletRequest {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 10 })
  kind: WalletRequestKind;

  @Column({ type: 'integer' })
  amountCents: number;

  @Column({ type: 'varchar', length: 10, default: 'pending' })
  status: WalletRequestStatus;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;
}
