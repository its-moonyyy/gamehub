import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, In, Not, Repository } from 'typeorm';
import { ONLINE_WINDOW_MS } from '../users/presence.js';
import { isUniqueViolation } from '../users/db-errors.js';
import { User } from '../users/user.entity.js';
import { Friendship } from './friendship.entity.js';

/** Friends are either here (their requests are arriving) or they are not. */
export type FriendStatus = 'online' | 'offline';

export interface FriendInfo {
  id: number;
  displayName: string;
  status: FriendStatus;
  lastSeenAt: Date | null;
  /** When the friendship was accepted. */
  friendsSince: Date;
}

/** A pending request, as either side of it sees it. */
export interface FriendRequestInfo {
  /** The friendship row — accept/decline/cancel by this id. */
  id: number;
  userId: number;
  displayName: string;
  status: FriendStatus;
  createdAt: Date;
}

export interface FriendsOverview {
  friends: FriendInfo[];
  incoming: FriendRequestInfo[];
  outgoing: FriendRequestInfo[];
}

/** Where the viewer stands with a player they found in search. */
export type FriendRelation = 'none' | 'friends' | 'outgoing' | 'incoming';

export interface PlayerSearchResult {
  id: number;
  displayName: string;
  status: FriendStatus;
  relation: FriendRelation;
  /** The pending request's id when the request is theirs, so it can be accepted right away. */
  requestId: number | null;
}

/** How many players one search may return. */
const SEARCH_LIMIT = 8;
/** Shorter queries match too much to be useful. */
const SEARCH_MIN_LENGTH = 2;

@Injectable()
export class FriendsService {
  constructor(
    @InjectRepository(Friendship)
    private readonly friendshipsRepository: Repository<Friendship>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  /**
   * The whole friend state in one payload — the friends page and the navbar
   * badge both read it, and every action answers with the fresh version.
   */
  async overview(viewerId: number): Promise<FriendsOverview> {
    const rows = await this.friendshipsRepository.find({
      where: [{ requesterId: viewerId }, { addresseeId: viewerId }],
      relations: { requester: true, addressee: true },
      order: { createdAt: 'ASC' },
    });

    const now = Date.now();
    const friends: FriendInfo[] = [];
    const incoming: FriendRequestInfo[] = [];
    const outgoing: FriendRequestInfo[] = [];

    for (const row of rows) {
      const iAmRequester = row.requesterId === viewerId;
      const other = iAmRequester ? row.addressee : row.requester;
      if (row.status === 'accepted') {
        friends.push({
          id: other.id,
          displayName: other.displayName,
          status: this.statusOf(other, now),
          lastSeenAt: other.lastSeenAt,
          friendsSince: row.updatedAt,
        });
        continue;
      }

      const request: FriendRequestInfo = {
        id: row.id,
        userId: other.id,
        displayName: other.displayName,
        status: this.statusOf(other, now),
        createdAt: row.createdAt,
      };
      (iAmRequester ? outgoing : incoming).push(request);
    }

    // Who is around first, then alphabetically — the list reads like a
    // lobby: people you can play with right now are at the top.
    friends.sort(
      (a, b) =>
        Number(b.status === 'online') - Number(a.status === 'online') ||
        a.displayName.localeCompare(b.displayName),
    );
    incoming.reverse();
    outgoing.reverse();

    return { friends, incoming, outgoing };
  }

  /** Finds players by phone number or display name, with the viewer's relation. */
  async search(viewerId: number, query: string): Promise<PlayerSearchResult[]> {
    const text = query?.trim() ?? '';
    if (text.length < SEARCH_MIN_LENGTH) {
      return [];
    }

    const digits = text.replace(/[\s\-()]/g, '');
    const lookups = [
      { displayName: ILike(`%${text}%`) },
      // A known full number can find its owner; fragments cannot enumerate accounts.
      ...(/^\+?[0-9]{9,15}$/.test(digits) ? [{ phoneNumber: digits }] : []),
    ];

    const users = await this.usersRepository.find({
      where: lookups.map((lookup) => ({ ...lookup, id: Not(viewerId) })),
      order: { displayName: 'ASC' },
      take: SEARCH_LIMIT,
    });
    if (!users.length) {
      return [];
    }

    const ids = users.map((user) => user.id);
    const rows = await this.friendshipsRepository.find({
      where: [
        { requesterId: viewerId, addresseeId: In(ids) },
        { requesterId: In(ids), addresseeId: viewerId },
      ],
    });
    const relationByUser = new Map(
      rows.map((row) => [
        row.requesterId === viewerId ? row.addresseeId : row.requesterId,
        row,
      ]),
    );

    const now = Date.now();
    return users.map((user) => {
      const row = relationByUser.get(user.id);
      let relation: FriendRelation = 'none';
      if (row?.status === 'accepted') {
        relation = 'friends';
      } else if (row?.requesterId === viewerId) {
        relation = 'outgoing';
      } else if (row) {
        relation = 'incoming';
      }

      return {
        id: user.id,
        displayName: user.displayName,
        status: this.statusOf(user, now),
        relation,
        requestId: relation === 'incoming' ? (row?.id ?? null) : null,
      };
    });
  }

  /**
   * Sends a request. If the other player already asked first, this is them
   * being added back, so the pending row is simply accepted.
   */
  async sendRequest(
    viewerId: number,
    targetId: number,
  ): Promise<FriendsOverview> {
    if (viewerId === targetId) {
      throw new BadRequestException('You cannot add yourself');
    }

    const target = await this.usersRepository.findOneBy({ id: targetId });
    if (!target) {
      throw new NotFoundException('That player no longer exists');
    }

    const existing = await this.findBetween(viewerId, targetId);
    if (existing) {
      if (existing.status === 'accepted') {
        throw new ConflictException('You are already friends');
      }
      if (existing.requesterId === viewerId) {
        throw new ConflictException('You already sent them a request');
      }
      return this.accept(viewerId, existing.id);
    }

    try {
      await this.friendshipsRepository.save(
        this.friendshipsRepository.create({
          requesterId: viewerId,
          addresseeId: targetId,
          status: 'pending',
        }),
      );
    } catch (error) {
      // Two taps in a row race past the lookup; the unique pair is the gate.
      if (isUniqueViolation(error)) {
        throw new ConflictException('You already sent them a request');
      }
      throw error;
    }

    return this.overview(viewerId);
  }

  /** Accepts a request addressed to the viewer. */
  async accept(viewerId: number, requestId: number): Promise<FriendsOverview> {
    const request = await this.friendshipsRepository.findOneBy({
      id: requestId,
      addresseeId: viewerId,
      status: 'pending',
    });
    if (!request) {
      throw new NotFoundException('This friend request is no longer open');
    }

    request.status = 'accepted';
    await this.friendshipsRepository.save(request);

    return this.overview(viewerId);
  }

  /** Declines a request addressed to the viewer — the row is dropped. */
  async decline(viewerId: number, requestId: number): Promise<FriendsOverview> {
    const result = await this.friendshipsRepository.delete({
      id: requestId,
      addresseeId: viewerId,
      status: 'pending',
    });
    if (!result.affected) {
      throw new NotFoundException('This friend request is no longer open');
    }

    return this.overview(viewerId);
  }

  /** Cancels a request the viewer sent — the row is dropped. */
  async cancel(viewerId: number, requestId: number): Promise<FriendsOverview> {
    const result = await this.friendshipsRepository.delete({
      id: requestId,
      requesterId: viewerId,
      status: 'pending',
    });
    if (!result.affected) {
      throw new NotFoundException('This friend request is no longer open');
    }

    return this.overview(viewerId);
  }

  /** Unfriends in either direction. */
  async remove(viewerId: number, friendId: number): Promise<FriendsOverview> {
    const row = await this.findBetween(viewerId, friendId);
    if (!row || row.status !== 'accepted') {
      throw new NotFoundException('You are not friends with this player');
    }

    await this.friendshipsRepository.delete({ id: row.id });

    return this.overview(viewerId);
  }

  /** True when the two accounts are accepted friends. */
  async areFriends(a: number, b: number): Promise<boolean> {
    const row = await this.findBetween(a, b);
    return row?.status === 'accepted';
  }

  private findBetween(a: number, b: number): Promise<Friendship | null> {
    return this.friendshipsRepository.findOne({
      where: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    });
  }

  /** Green while their requests keep arriving — same window the seat dots use. */
  private statusOf(
    user: Pick<User, 'lastSeenAt'>,
    now: number,
  ): FriendStatus {
    return user.lastSeenAt &&
      now - user.lastSeenAt.getTime() <= ONLINE_WINDOW_MS
      ? 'online'
      : 'offline';
  }
}
