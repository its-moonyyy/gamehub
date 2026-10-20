import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizePhone, PHONE_PATTERN } from '../../auth/dto/register.dto.js';

/** Profile edits from the settings page — every field is optional. */
export class UpdateProfileDto {
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(2, { message: 'displayName must be at least 2 characters' })
  @MaxLength(60, { message: 'displayName must be at most 60 characters' })
  displayName?: string;

  @IsOptional()
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be 9–15 digits, optionally starting with +',
  })
  phoneNumber?: string;
}
