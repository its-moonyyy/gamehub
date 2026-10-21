import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AdminOnly } from '../auth/admin-access.decorator.js';
import { CreditUserDto } from './dto/credit-user.dto.js';
import { WalletService, type AdminAdjustmentInfo, type WalletUserInfo } from './wallet.service.js';

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly wallet: WalletService) {}

  @Get('users')
  users(@Query('q') query = ''): Promise<WalletUserInfo[]> {
    return this.wallet.searchUsers(query);
  }

  @Get('credits')
  credits(): Promise<AdminAdjustmentInfo[]> {
    return this.wallet.recentCredits();
  }

  @Get('adjustments')
  adjustments(): Promise<AdminAdjustmentInfo[]> {
    return this.wallet.recentAdjustments();
  }

  @Post('users/:id/credits')
  credit(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: CreditUserDto,
  ): Promise<AdminAdjustmentInfo> {
    return this.wallet.creditByAdmin(userId, dto.amountCents);
  }

  @Post('users/:id/withdrawals')
  withdraw(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: CreditUserDto,
  ): Promise<AdminAdjustmentInfo> {
    return this.wallet.withdrawByAdmin(userId, dto.amountCents);
  }
}
