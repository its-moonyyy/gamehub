import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AdminOnly } from '../auth/admin-access.decorator.js';
import { CreditUserDto } from './dto/credit-user.dto.js';
import { WalletService, type AdminCreditInfo, type WalletUserInfo } from './wallet.service.js';

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly wallet: WalletService) {}

  @Get('users')
  users(@Query('q') query = ''): Promise<WalletUserInfo[]> {
    return this.wallet.searchUsers(query);
  }

  @Get('credits')
  credits(): Promise<AdminCreditInfo[]> {
    return this.wallet.recentCredits();
  }

  @Post('users/:id/credits')
  credit(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: CreditUserDto,
  ): Promise<AdminCreditInfo> {
    return this.wallet.creditByAdmin(userId, dto.amountCents);
  }
}
