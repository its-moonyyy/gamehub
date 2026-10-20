import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Game } from './game.entity.js';

type GameSeed = Pick<
  Game,
  | 'slug'
  | 'name'
  | 'description'
  | 'icon'
  | 'players'
  | 'maxSeats'
  | 'status'
  | 'sortOrder'
>;

const SEED_GAMES: GameSeed[] = [
  {
    slug: 'poker',
    name: "Texas Hold'em Poker",
    description:
      'Classic Hold’em. Post the blinds, outplay the table and take the pot — real players only.',
    icon: 'spade',
    players: '2–8',
    maxSeats: 8,
    status: 'available',
    sortOrder: 1,
  },
  {
    slug: 'ludo',
    name: 'Ludo',
    description:
      'The classic board race. Roll the dice, chase your friends home with all four tokens — real players only.',
    icon: 'dice',
    players: '2–4',
    maxSeats: 4,
    status: 'available',
    sortOrder: 2,
  },
  {
    slug: 'dominoes',
    name: 'Dominoes',
    description:
      'Draw dominoes, double-six. Match the open ends, block the table and empty your hand before your friends do — real players only.',
    icon: 'domino',
    players: '2–4',
    maxSeats: 4,
    status: 'available',
    sortOrder: 3,
  },
  {
    slug: 'chess',
    name: 'Chess',
    description:
      'The classic duel. Open, castle and mate your friend before your clock runs out — real players only.',
    icon: 'chess',
    players: '2',
    maxSeats: 2,
    status: 'available',
    sortOrder: 4,
  },
  {
    slug: 'uno',
    name: 'Uno',
    description:
      'Match the colour or the number, dump your hand and shout UNO — real players only.',
    icon: 'layers',
    players: '2–6',
    maxSeats: 6,
    status: 'available',
    sortOrder: 5,
  },
];

@Injectable()
export class GamesService implements OnModuleInit {
  constructor(
    @InjectRepository(Game)
    private readonly gamesRepository: Repository<Game>,
  ) {}

  /** Keep the catalog in sync with the seed list on every boot. */
  async onModuleInit(): Promise<void> {
    for (const seed of SEED_GAMES) {
      const existing = await this.gamesRepository.findOneBy({ slug: seed.slug });
      if (existing) {
        Object.assign(existing, seed);
        await this.gamesRepository.save(existing);
      } else {
        await this.gamesRepository.save(this.gamesRepository.create(seed));
      }
    }
  }

  findAll(): Promise<Game[]> {
    return this.gamesRepository.find({ order: { sortOrder: 'ASC' } });
  }

  async findBySlug(slug: string): Promise<Game> {
    const game = await this.gamesRepository.findOneBy({ slug });
    if (!game) {
      throw new NotFoundException(`Game "${slug}" not found`);
    }
    return game;
  }
}
