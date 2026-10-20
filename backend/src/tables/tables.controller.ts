import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { InviteFriendDto } from './dto/invite-friend.dto.js';
import { TableActionDto } from './dto/table-action.dto.js';
import { TableIdPipe } from './table-id.pipe.js';
import {
  PendingInviteInfo,
  TableDetails,
  TableInviteInfo,
  TablesService,
  TableSummary,
} from './tables.service.js';

/** All table routes require a logged-in user (no @Public here). */
@Controller()
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('games/:slug/tables')
  listByGame(@Param('slug') slug: string): Promise<TableSummary[]> {
    return this.tablesService.listByGameSlug(slug);
  }

  @Post('games/:slug/tables')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: CreateTableDto,
  ): Promise<TableDetails> {
    return this.tablesService.create(user.id, slug, dto);
  }

  @Get('tables/:id')
  details(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
  ): Promise<TableDetails> {
    return this.tablesService.getDetails(id, user.id);
  }

  @Post('tables/:id/join')
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
  ): Promise<TableDetails> {
    return this.tablesService.join(user.id, id);
  }

  @Post('tables/:id/action')
  act(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
    @Body() dto: TableActionDto,
  ): Promise<TableDetails> {
    return this.tablesService.act(user.id, id, dto);
  }

  @Post('tables/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
  ): Promise<void> {
    await this.tablesService.leave(user.id, id);
  }

  /** Invite a friend to this table — you must be seated here yourself. */
  @Post('tables/:id/invites')
  invite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
    @Body() dto: InviteFriendDto,
  ): Promise<PendingInviteInfo[]> {
    return this.tablesService.inviteFriend(user.id, id, dto.userId);
  }

  /** The open invites on this table, for the invite dialog's states. */
  @Get('tables/:id/invites')
  pendingInvites(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', TableIdPipe) id: number,
  ): Promise<PendingInviteInfo[]> {
    return this.tablesService.listTableInvites(user.id, id);
  }

  /** The invites addressed to the viewer, across all tables. */
  @Get('invites')
  myInvites(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TableInviteInfo[]> {
    return this.tablesService.listInvites(user.id);
  }

  /** Accepting seats you at the table and answers with its full state. */
  @Post('invites/:id/accept')
  acceptInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TableDetails> {
    return this.tablesService.acceptInvite(user.id, id);
  }

  /** Declining closes the invite. */
  @Post('invites/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  async declineInvite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.tablesService.declineInvite(user.id, id);
  }
}
