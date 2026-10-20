import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import {
  UserProfile,
  UserProfileWithStats,
  UsersService,
} from './users.service.js';

/** Your own account: profile, stats and edits. Every route needs a token. */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileWithStats> {
    return this.usersService.profileWithStats(user.id);
  }

  @Patch('me')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return this.usersService.updateProfile(user.id, dto);
  }
}
