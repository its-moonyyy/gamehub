import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/** Changing your own password: prove the old one, then pick a new one. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'newPassword must be at least 8 characters' })
  @MaxLength(72, { message: 'newPassword must be at most 72 characters' })
  newPassword: string;
}
