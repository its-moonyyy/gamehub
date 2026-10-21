import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** The price the player agreed to pay, checked against the current table. */
export class ConfirmSeatDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  entryFee?: number;
}
