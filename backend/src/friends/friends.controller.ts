import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { SendFriendRequestDto } from './dto/send-friend-request.dto.js';
import {
  FriendsOverview,
  FriendsService,
  PlayerSearchResult,
} from './friends.service.js';

/** Friends are account business — every route requires a token. */
@Controller('friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get()
  overview(@CurrentUser() user: AuthenticatedUser): Promise<FriendsOverview> {
    return this.friendsService.overview(user.id);
  }

  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') query = '',
  ): Promise<PlayerSearchResult[]> {
    return this.friendsService.search(user.id, query);
  }

  @Post('requests')
  send(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendFriendRequestDto,
  ): Promise<FriendsOverview> {
    return this.friendsService.sendRequest(user.id, dto.userId);
  }

  @Post('requests/:id/accept')
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<FriendsOverview> {
    return this.friendsService.accept(user.id, id);
  }

  @Post('requests/:id/decline')
  decline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<FriendsOverview> {
    return this.friendsService.decline(user.id, id);
  }

  /** The sender takes a request back. */
  @Delete('requests/:id')
  cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<FriendsOverview> {
    return this.friendsService.cancel(user.id, id);
  }

  @Delete(':userId')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<FriendsOverview> {
    return this.friendsService.remove(user.id, userId);
  }
}
