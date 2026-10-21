import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AuthResult } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';
import { Public } from './public.decorator.js';
import type { UserProfile } from '../users/users.service.js';
import type { AdminProfile } from './auth.service.js';
import { AdminAllowed } from './admin-access.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthResult> {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthResult> {
    return this.authService.login(dto);
  }

  @Get('me')
  @AdminAllowed()
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile | AdminProfile> {
    return this.authService.profile(user);
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(user.id, dto);
  }
}
