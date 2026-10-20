import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity.js';

/**
 * One friend connection, in one row. `pending` is a request running from the
 * requester to the addressee; `accepted` is a friendship, whichever way round
 * it was asked. Declining and cancelling delete the row, so a request can
 * always be sent again later.
 */
export type FriendshipStatus = 'pending' | 'accepted';

@Entity('friendships')
@Unique(['requesterId', 'addresseeId'])
@Index(['addresseeId'])
export class Friendship {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  requesterId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requesterId' })
  requester: User;

  @Column()
  addresseeId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'addresseeId' })
  addressee: User;

  // The column type is explicit: SWC's decorator metadata emits `Object` for
  // a type alias, and TypeORM cannot infer a column type from that.
  @Column({ type: 'varchar', length: 12, default: 'pending' })
  status: FriendshipStatus;

  @CreateDateColumn()
  createdAt: Date;

  /** When the request was answered — for an accepted row, the friends-since stamp. */
  @UpdateDateColumn()
  updatedAt: Date;
}
