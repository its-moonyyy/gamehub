import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type GameStatus = 'available' | 'coming_soon';

@Entity('games')
export class Game {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 40 })
  slug: string;

  @Column({ length: 80 })
  name: string;

  @Column({ length: 240 })
  description: string;

  /** Lucide icon key rendered by the frontend (e.g. "spade", "dice"). */
  @Column({ length: 40 })
  icon: string;

  /**
   * Players label shown on the game card, e.g. "2–8". Long enough for the
   * two-digit range plus its en dash — a shorter column makes `synchronize`
   * try to shrink a column that already holds values (and fail).
   */
  @Column({ length: 20 })
  players: string;

  /** Maximum seats a table of this game can host. */
  @Column({ type: 'integer', default: 4 })
  maxSeats: number;

  @Column({ type: 'varchar', default: 'coming_soon' })
  status: GameStatus;

  @Column({ type: 'integer', default: 0 })
  sortOrder: number;
}
