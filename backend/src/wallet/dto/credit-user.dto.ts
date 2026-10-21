import { IsInt, Max, Min } from 'class-validator';

export class CreditUserDto {
  /** Positive virtual cents, capped to keep integer balances safe. */
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents: number;
}
