import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 20 })
  phoneNumber: string;

  @Column()
  passwordHash: string;

  @Column({ length: 60 })
  displayName: string;

  /** Shared virtual balance in cents; only the admin can mint new credits. */
  @Column({ type: 'integer', default: 0 })
  balance: number;

  /**
   * Last time this account talked to the API. Read by the seat status dots
   * (online / offline); null for accounts that never signed in again.
   */
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
