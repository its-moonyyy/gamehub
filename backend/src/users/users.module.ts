import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TablePlayer } from '../tables/table-player.entity.js';
import { Table } from '../tables/table.entity.js';
import { GameResult } from '../tables/game-result.entity.js';
import { User } from './user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // Profile stats read the tables a user created and the seats they hold.
  imports: [TypeOrmModule.forFeature([User, Table, TablePlayer, GameResult])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
