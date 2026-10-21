import { IsIn, IsInt, Max, Min } from 'class-validator';
import type { WalletRequestKind } from '../wallet-request.entity.js';

export class CreateWalletRequestDto {
  @IsIn(['deposit', 'withdrawal'])
  kind: WalletRequestKind;

  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amountCents: number;
}
