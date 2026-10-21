import {
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import { CHESS_TIME_CONTROL_IDS } from '../../chess/chess-engine.js';

export class CreateTableDto {
  /** Seat price in cents; also the poker starting stack. */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  entryFee: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(8)
  maxSeats?: number;

  /** Chess only: the clock the table starts with, e.g. "3+2". */
  @IsOptional()
  @IsIn(CHESS_TIME_CONTROL_IDS, {
    message: 'timeControl must be one of the offered clocks',
  })
  timeControl?: string;

  /** Non-chess games: seconds allowed for each player's turn. */
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(300)
  turnSeconds?: number;

  /** In cents, e.g. 100 = $1. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  smallBlind?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  bigBlind?: number;
}
