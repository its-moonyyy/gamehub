import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FriendsModule } from '../friends/friends.module.js';
import { Game } from '../games/game.entity.js';
import { User } from '../users/user.entity.js';
import { GameEventsService } from './game-events.service.js';
import { GameResult } from './game-result.entity.js';
import { TableInvite } from './table-invite.entity.js';
import { TablePlayer } from './table-player.entity.js';
import { Table } from './table.entity.js';
import { TablesController } from './tables.controller.js';
import { TablesService } from './tables.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Table,
      TablePlayer,
      Game,
      TableInvite,
      User,
      GameResult,
    ]),
    // Invites are friends-only, so the tables service asks the friends service.
    FriendsModule,
  ],
  controllers: [TablesController],
  providers: [TablesService, GameEventsService],
})
export class TablesModule {}
