import { IsInt, Min } from 'class-validator';

/** The friend to invite — picked from the invite dialog's friend list. */
export class InviteFriendDto {
  @IsInt()
  @Min(1)
  userId: number;
}
