import { Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AdminOnly } from './admin-access.decorator.js';
import { AuthService } from './auth.service.js';
import { ResetUserPasswordDto } from './dto/reset-user-password.dto.js';

@AdminOnly()
@Controller('admin/users')
export class AdminAccountController {
  constructor(private readonly auth: AuthService) {}

  @Post(':id/password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(
    @Param('id', ParseIntPipe) userId: number,
    @Body() dto: ResetUserPasswordDto,
  ): Promise<void> {
    return this.auth.resetPasswordByAdmin(userId, dto.newPassword);
  }
}
