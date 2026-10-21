import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity.js';
import { WalletEntry } from './wallet-entry.entity.js';

const MAX_BALANCE = 2_147_483_647;

export interface WalletUserInfo {
  id: number;
  phoneNumber: string;
  displayName: string;
  balance: number;
}

export interface AdminCreditInfo {
  id: number;
  userId: number;
  phoneNumber: string;
  displayName: string;
  amountCents: number;
  balance: number;
  createdAt: Date;
}

@Injectable()
export class WalletService {
  constructor(private readonly dataSource: DataSource) {}

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

  async recentCredits(): Promise<AdminCreditInfo[]> {
    const entries = await this.dataSource.getRepository(WalletEntry).find({
      where: { kind: 'admin_credit' },
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
      balance: entry.user.balance,
      createdAt: entry.createdAt,
    }));
  }

  async creditByAdmin(userId: number, amountCents: number): Promise<AdminCreditInfo> {
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
        balance: user.balance,
        createdAt: entry.createdAt,
      };
    });
  }
}
