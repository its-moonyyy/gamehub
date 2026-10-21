import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminController } from './admin.controller.js';
import { WalletEntry } from './wallet-entry.entity.js';
import { WalletService } from './wallet.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([WalletEntry])],
  controllers: [AdminController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
