import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../auth/public.decorator.js';
import { Game } from './game.entity.js';
import { GamesService } from './games.service.js';

@Public()
@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  findAll(): Promise<Game[]> {
    return this.gamesService.findAll();
  }

  @Get(':slug')
  findBySlug(@Param('slug') slug: string): Promise<Game> {
    return this.gamesService.findBySlug(slug);
  }
}
