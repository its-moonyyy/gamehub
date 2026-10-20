import { IsInt, Min } from 'class-validator';

/** The player to add — you pick them from search, so the id is the handle. */
export class SendFriendRequestDto {
  @IsInt()
  @Min(1)
  userId: number;
}
