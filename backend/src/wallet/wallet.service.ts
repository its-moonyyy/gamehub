import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity.js';
import { WalletEntry } from './wallet-entry.entity.js';
import { WalletRequest, type WalletRequestKind, type WalletRequestStatus } from './wallet-request.entity.js';

const MAX_BALANCE = 2_147_483_647;

export interface WalletUserInfo {
  id: number;
  phoneNumber: string;
  displayName: string;
  balance: number;
}

export interface AdminAdjustmentInfo {
  id: number;
  userId: number;
  phoneNumber: string;
  displayName: string;
  amountCents: number;
  kind: 'admin_credit' | 'admin_withdrawal';
  balance: number;
  createdAt: Date;
}

export interface WalletRequestInfo {
  id: number;
  userId: number;
  phoneNumber: string;
  displayName: string;
  kind: WalletRequestKind;
  amountCents: number;
  status: WalletRequestStatus;
  createdAt: Date;
  reviewedAt: Date | null;
}

@Injectable()
export class WalletService {
  constructor(private readonly dataSource: DataSource) {}

  private requestInfo(request: WalletRequest): WalletRequestInfo {
    return {
      id: request.id,
      userId: request.userId,
      phoneNumber: request.user.phoneNumber,
      displayName: request.user.displayName,
      kind: request.kind,
      amountCents: request.amountCents,
      status: request.status,
      createdAt: request.createdAt,
      reviewedAt: request.reviewedAt,
    };
  }

  async myRequests(userId: number): Promise<WalletRequestInfo[]> {
    const requests = await this.dataSource.getRepository(WalletRequest).find({
      where: { userId },
      relations: { user: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 20,
    });
    return requests.map((request) => this.requestInfo(request));
  }

  async pendingRequests(): Promise<WalletRequestInfo[]> {
    const requests = await this.dataSource.getRepository(WalletRequest).find({
      where: { status: 'pending' },
      relations: { user: true },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return requests.map((request) => this.requestInfo(request));
  }

  async createRequest(userId: number, kind: WalletRequestKind, amountCents: number): Promise<WalletRequestInfo> {
    const user = await this.dataSource.getRepository(User).findOneBy({ id: userId });
    if (!user) throw new NotFoundException('Player not found');
    if (kind === 'withdrawal' && user.balance < amountCents) {
      throw new BadRequestException('Insufficient player balance');
    }
    const request = await this.dataSource.getRepository(WalletRequest).save({
      userId, kind, amountCents, status: 'pending', reviewedAt: null,
    });
    request.user = user;
    return this.requestInfo(request);
  }

  async reviewRequest(id: number, decision: 'accepted' | 'declined'): Promise<WalletRequestInfo> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(WalletRequest, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!request) throw new NotFoundException('Transaction request not found');
      if (request.status !== 'pending') throw new ConflictException('Transaction request already reviewed');
      const user = await manager.findOne(User, {
        where: { id: request.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Player not found');

      if (decision === 'accepted') {
        if (request.kind === 'deposit') {
          if (user.balance > MAX_BALANCE - request.amountCents) {
            throw new BadRequestException('This deposit would exceed the balance limit');
          }
          user.balance += request.amountCents;
        } else {
          if (user.balance < request.amountCents) {
            throw new BadRequestException('Insufficient player balance');
          }
          user.balance -= request.amountCents;
        }
        await manager.save(user);
        await manager.save(manager.create(WalletEntry, {
          userId: user.id,
          amount: request.kind === 'deposit' ? request.amountCents : -request.amountCents,
          kind: request.kind === 'deposit' ? 'admin_credit' : 'admin_withdrawal',
          reference: `wallet-request:${request.id}`,
        }));
      }
      request.status = decision;
      request.reviewedAt = new Date();
      await manager.save(request);
      request.user = user;
      return this.requestInfo(request);
    });
  }

  async searchUsers(query: string): Promise<WalletUserInfo[]> {
    const text = query.trim().slice(0, 60);
    const normalizedPhone = text.replace(/[\s\-()]/g, '');
    if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) return [];
    const user = await this.dataSource.getRepository(User).findOneBy({
      phoneNumber: normalizedPhone,
    });
    return user
      ? [{ id: user.id, phoneNumber: user.phoneNumber, displayName: user.displayName, balance: user.balance }]
      : [];
  }

  async recentAdjustments(): Promise<AdminAdjustmentInfo[]> {
    return this.recentEntries(['admin_credit', 'admin_withdrawal']);
  }

  async recentCredits(): Promise<AdminAdjustmentInfo[]> {
    return this.recentEntries(['admin_credit']);
  }

  private async recentEntries(kinds: AdminAdjustmentInfo['kind'][]): Promise<AdminAdjustmentInfo[]> {
    const entries = await this.dataSource.getRepository(WalletEntry).find({
      where: kinds.map((kind) => ({ kind })),
      relations: { user: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: 20,
    });
    return entries.map((entry) => ({
      id: entry.id,
      userId: entry.userId,
      phoneNumber: entry.user.phoneNumber,
      displayName: entry.user.displayName,
      amountCents: entry.amount,
      kind: entry.kind as AdminAdjustmentInfo['kind'],
      balance: entry.user.balance,
      createdAt: entry.createdAt,
    }));
  }

  async creditByAdmin(userId: number, amountCents: number): Promise<AdminAdjustmentInfo> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Player not found');
      if (user.balance > MAX_BALANCE - amountCents) {
        throw new BadRequestException('This credit would exceed the balance limit');
      }
      user.balance += amountCents;
      await manager.save(user);
      const entry = await manager.save(
        manager.create(WalletEntry, {
          userId,
          amount: amountCents,
          kind: 'admin_credit',
          reference: null,
        }),
      );
      return {
        id: entry.id,
        userId,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        amountCents,
        kind: 'admin_credit',
        balance: user.balance,
        createdAt: entry.createdAt,
      };
    });
  }

  async withdrawByAdmin(userId: number, amountCents: number): Promise<AdminAdjustmentInfo> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) throw new NotFoundException('Player not found');
      if (user.balance < amountCents) {
        throw new BadRequestException('Insufficient player balance');
      }
      user.balance -= amountCents;
      await manager.save(user);
      const entry = await manager.save(
        manager.create(WalletEntry, {
          userId,
          amount: -amountCents,
          kind: 'admin_withdrawal',
          reference: null,
        }),
      );
      return {
        id: entry.id,
        userId,
        phoneNumber: user.phoneNumber,
        displayName: user.displayName,
        amountCents: entry.amount,
        kind: 'admin_withdrawal',
        balance: user.balance,
        createdAt: entry.createdAt,
      };
    });
  }
}
