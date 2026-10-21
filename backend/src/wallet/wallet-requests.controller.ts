import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { CreateWalletRequestDto } from './dto/create-wallet-request.dto.js';
import { WalletService, type WalletRequestInfo } from './wallet.service.js';

@Controller('wallet/requests')
export class WalletRequestsController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  mine(@CurrentUser() user: AuthenticatedUser): Promise<WalletRequestInfo[]> {
    return this.wallet.myRequests(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWalletRequestDto,
  ): Promise<WalletRequestInfo> {
    return this.wallet.createRequest(user.id, dto.kind, dto.amountCents);
  }
}
