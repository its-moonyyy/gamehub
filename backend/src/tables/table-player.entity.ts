import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../users/user.entity.js';
import { Table } from './table.entity.js';

/** One human sitting at one seat of a table. */
@Entity('table_players')
@Unique(['tableId', 'seatIndex'])
@Unique(['tableId', 'userId'])
export class TablePlayer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  tableId: number;

  @ManyToOne(() => Table, (table) => table.players, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tableId' })
  table: Table;

  @Column()
  userId: number;

  @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'integer' })
  seatIndex: number;

  @CreateDateColumn()
  joinedAt: Date;
}
