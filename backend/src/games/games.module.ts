import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Game } from './game.entity.js';
import { GamesController } from './games.controller.js';
import { GamesService } from './games.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Game])],
  controllers: [GamesController],
  providers: [GamesService],
})
export class GamesModule {}
