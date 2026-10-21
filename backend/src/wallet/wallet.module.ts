import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller.js';
import { WalletEntry } from './wallet-entry.entity.js';
import { WalletRequest } from './wallet-request.entity.js';
import { WalletRequestsController } from './wallet-requests.controller.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WalletEntry, WalletRequest])],
  controllers: [AdminController, WalletRequestsController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
