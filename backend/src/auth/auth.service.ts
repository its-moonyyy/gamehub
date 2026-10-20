import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
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

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}

const BCRYPT_ROUNDS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
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
    const user = await this.usersService.findByPhoneNumber(dto.phoneNumber);
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid phone number or password');
    }

    // Signing in is the strongest proof of presence there is.
    await this.usersService.touch(user.id, true);

    return this.buildAuthResult(user);
  }

  async profile(id: number): Promise<UserProfile> {
    const user = await this.usersService.findById(id);
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

    user.passwordHash = await hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.usersService.save(user);
  }

  private async buildAuthResult(user: User): Promise<AuthResult> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      phoneNumber: user.phoneNumber,
      displayName: user.displayName,
    });

    return { accessToken, user: toProfile(user) };
  }
}
