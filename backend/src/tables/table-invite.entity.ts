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
import { Table } from './table.entity.js';

/**
 * A seat offer from someone at a table to a friend. Rows exist only while an
 * invite is open: accepting, declining or the table disappearing removes it,
 * so the same friend can be invited to the same table again later.
 */
@Entity('table_invites')
@Unique(['tableId', 'inviteeId'])
@Index(['inviteeId'])
export class TableInvite {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tableId: number;

  @ManyToOne(() => Table, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tableId' })
  table: Table;

  @Column()
  inviterId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviterId' })
  inviter: User;

  @Column()
  inviteeId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviteeId' })
  invitee: User;

  @CreateDateColumn()
  createdAt: Date;
}
