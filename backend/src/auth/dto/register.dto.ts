import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Digits only, optional leading +, 9–15 digits (E.164-friendly). */
export const PHONE_PATTERN = /^\+?[0-9]{9,15}$/;

/** The separators people type into phone fields: `+49 170 123-45 (67)`. */
export function normalizePhone(value: unknown): unknown {
  return typeof value === 'string' ? value.replace(/[\s\-()]/g, '') : value;
}

export class RegisterDto {
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @Matches(PHONE_PATTERN, {
    message: 'phoneNumber must be 9–15 digits, optionally starting with +',
  })
  phoneNumber: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(72, { message: 'password must be at most 72 characters' })
  password: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  displayName: string;
}
