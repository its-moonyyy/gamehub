import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';
import { normalizePhone } from './register.dto.js';

export class LoginDto {
  /** Normalised like registration, so `+49 170 123-45 67` still logs you in. */
  @Transform(({ value }) => normalizePhone(value))
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}
