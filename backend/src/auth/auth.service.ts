import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity.js';
import {
  toProfile,
  UserProfile,
  UsersService,
} from '../users/users.service.js';
import { isUniqueViolation } from '../users/db-errors.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import type { AuthenticatedUser } from './auth.guard.js';

export interface AdminProfile {
  id: 0;
  phoneNumber: '';
  displayName: 'Administrator';
  balance: 0;
  createdAt: Date;
  role: 'admin';
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile | AdminProfile;
}

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.usersService.findByPhoneNumber(dto.phoneNumber);
    if (existing) {
      throw new ConflictException('This phone number is already registered');
    }

    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    let user: User;
    try {
      user = await this.usersService.create({
        phoneNumber: dto.phoneNumber,
        passwordHash,
        displayName: dto.displayName.trim(),
      });
    } catch (error) {
      // Two registrations can race past the check above; report the same
      // conflict the check would have reported.
      if (isUniqueViolation(error)) {
        throw new ConflictException('This phone number is already registered');
      }
      throw error;
    }
    // You are online the moment you have an account.
    await this.usersService.touch(user.id, true);

    return this.buildAuthResult(user);
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    if (dto.phoneNumber === 'openAdmin') {
      const passwordHash = this.config.get<string>('ADMIN_PASSWORD_HASH');
      if (!passwordHash || !(await compare(dto.password, passwordHash))) {
        throw new UnauthorizedException('Invalid credentials');
      }
      return {
        accessToken: await this.jwtService.signAsync(
          { sub: 0, role: 'admin' },
          { expiresIn: '1h' },
        ),
        user: this.adminProfile(),
      };
    }
    const user = await this.usersService.findByPhoneNumber(dto.phoneNumber);
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    // Signing in is the strongest proof of presence there is.
    await this.usersService.touch(user.id, true);

    return this.buildAuthResult(user);
  }

  async profile(account: AuthenticatedUser): Promise<UserProfile | AdminProfile> {
    if (account.role === 'admin') return this.adminProfile();
    const user = await this.usersService.findById(account.id);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    return toProfile(user);
  }

  /**
   * Changes the password of a logged-in user. Existing tokens keep working
   * (they are stateless), so the user stays signed in on this device.
   */
  async changePassword(id: number, dto: ChangePasswordDto): Promise<void> {
    const user = await this.usersService.findById(id);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }

    if (!(await compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException(
        'The new password must differ from the current one',
      );
    }

    const newHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
    if (!await this.usersService.updatePasswordIfCurrent(id, user.passwordHash, newHash)) {
      throw new UnauthorizedException('Password changed, sign in again');
    }
  }

  async resetPasswordByAdmin(id: number, newPassword: string): Promise<void> {
    const passwordHash = await hash(newPassword, BCRYPT_ROUNDS);
    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Player not found');
      if (await compare(newPassword, user.passwordHash)) {
        throw new BadRequestException('The new password must differ from the current one');
      }
      user.passwordHash = passwordHash;
      user.sessionVersion += 1;
      await manager.save(user);
    });
  }

  private async buildAuthResult(user: User): Promise<AuthResult> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName,
      sessionVersion: user.sessionVersion,
    });

    return { accessToken, user: toProfile(user) };
  }

  private adminProfile(): AdminProfile {
    return {
      id: 0,
      phoneNumber: '',
      displayName: 'Administrator',
      balance: 0,
      createdAt: new Date(0),
      role: 'admin',
    };
  }
}
