import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CHESS_TIME_CONTROL_IDS } from '../../chess/chess-engine.js';

export class CreateTableDto {
  @IsString()
  @MinLength(2, { message: 'name must be at least 2 characters' })
  @MaxLength(40, { message: 'name must be at most 40 characters' })
  name: string;

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
