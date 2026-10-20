import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TablePlayer } from '../tables/table-player.entity.js';
import { Table } from '../tables/table.entity.js';
import { isUniqueViolation } from './db-errors.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { User } from './user.entity.js';

/** Shape returned by the API — never exposes the password hash. */
export interface UserProfile {
  id: number;
  phoneNumber: string;
  displayName: string;
  balance: number;
  createdAt: Date;
}

/** A table the user currently holds a seat at. */
export interface SeatedTableSummary {
  id: number;
  name: string;
  gameSlug: string;
  gameName: string;
  seatedCount: number;
  maxSeats: number;
}

export interface UserStats {
  /** Tables this user opened. */
  tablesCreated: number;
  /** Tables this user is sitting at right now — rejoin straight from the profile. */
  seatedTables: SeatedTableSummary[];
}

export interface UserProfileWithStats extends UserProfile {
  stats: UserStats;
}

export function toProfile(user: User): UserProfile {
  return {
    id: user.id,
    phoneNumber: user.phoneNumber,
    displayName: user.displayName,
    balance: user.balance,
    createdAt: user.createdAt,
  };
}

/** Presence heartbeat is written at most this often per user. */
const TOUCH_INTERVAL_MS = 10_000;

@Injectable()
export class UsersService {
  /** When each user's presence was last written, so polls stay cheap. */
  private readonly lastSeenWrites = new Map<number, number>();

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Table)
    private readonly tablesRepository: Repository<Table>,
    @InjectRepository(TablePlayer)
    private readonly tablePlayersRepository: Repository<TablePlayer>,
  ) {}

  findByPhoneNumber(phoneNumber: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ phoneNumber });
  }

  findById(id: number): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  create(data: {
    phoneNumber: string;
    passwordHash: string;
    displayName: string;
  }): Promise<User> {
    const user = this.usersRepository.create(data);
    return this.usersRepository.save(user);
  }

  save(user: User): Promise<User> {
    return this.usersRepository.save(user);
  }

  /**
   * Records that this user is around — the heartbeat behind the seat status
   * dots. Throttled, because a room polls every second and presence only
   * needs minute-level accuracy. Pass `force` when the request itself proves
   * the user just arrived (login, registration).
   */
  async touch(id: number, force = false): Promise<void> {
    const now = Date.now();
    const lastWrite = this.lastSeenWrites.get(id) ?? 0;
    if (!force && now - lastWrite < TOUCH_INTERVAL_MS) {
      return;
    }

    this.lastSeenWrites.set(id, now);
    try {
      await this.usersRepository.update({ id }, { lastSeenAt: new Date(now) });
    } catch {
      // Presence is decoration: a failed heartbeat must never fail a request.
      // Forget the attempt so the next call tries again.
      this.lastSeenWrites.delete(id);
    }
  }

  /** The profile page payload: who you are plus what you are up to. */
  async profileWithStats(id: number): Promise<UserProfileWithStats> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('Account no longer exists');
    }

    return { ...toProfile(user), stats: await this.stats(id) };
  }

  async stats(id: number): Promise<UserStats> {
    const [tablesCreated, seats] = await Promise.all([
      this.tablesRepository.count({ where: { createdBy: { id } } }),
      this.tablePlayersRepository.find({
        where: { userId: id },
        relations: { table: { game: true } },
        order: { joinedAt: 'DESC' },
      }),
    ]);

    const takenRows = seats.length
      ? await this.tablePlayersRepository
          .createQueryBuilder('player')
          .select('player.tableId', 'tableId')
          .addSelect('COUNT(*)', 'count')
          .where('player.tableId IN (:...tableIds)', {
            tableIds: seats.map((seat) => seat.tableId),
          })
          .groupBy('player.tableId')
          .getRawMany<{ tableId: number; count: string }>()
      : [];
    const seatsTaken = new Map(
      takenRows.map((row) => [Number(row.tableId), Number(row.count)]),
    );

    return {
      tablesCreated,
      seatedTables: seats.map((seat) => ({
        id: seat.table.id,
        name: seat.table.name,
        gameSlug: seat.table.game.slug,
        gameName: seat.table.game.name,
        seatedCount: seatsTaken.get(seat.tableId) ?? 1,
        maxSeats: seat.table.maxSeats,
      })),
    };
  }

  /**
   * Edits the display name and phone number only — password changes go
   * through the auth service, which owns password hashing.
   */
  async updateProfile(id: number, dto: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException('Account no longer exists');
    }

    if (dto.phoneNumber && dto.phoneNumber !== user.phoneNumber) {
      const taken = await this.usersRepository.findOneBy({
        phoneNumber: dto.phoneNumber,
      });
      if (taken) {
        throw new ConflictException(
          'This phone number is already registered',
        );
      }
      user.phoneNumber = dto.phoneNumber;
    }

    if (dto.displayName) {
      user.displayName = dto.displayName;
    }

    try {
      return toProfile(await this.usersRepository.save(user));
    } catch (error) {
      // Someone claimed the same phone number between the check and the
      // write — the unique index wins, and the caller still gets a 409.
      if (isUniqueViolation(error)) {
        throw new ConflictException('This phone number is already registered');
      }
      throw error;
    }
  }
}
