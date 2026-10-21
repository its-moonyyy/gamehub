import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ADMIN_ACCESS_KEY, type AdminAccess } from './admin-access.decorator.js';

export interface AuthenticatedUser {
  id: number;
  phoneNumber: string;
  displayName: string;
  role: 'player' | 'admin';
}

interface JwtPayload {
  sub: number;
  phoneNumber: string;
  displayName: string;
  role?: 'admin';
  sessionVersion?: number;
}

type RequestWithUser = Request & { user?: AuthenticatedUser };

/**
 * Global guard: every route requires a valid Bearer token unless it is
 * marked with @Public().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const adminAccess = this.reflector.getAllAndOverride<AdminAccess>(
      ADMIN_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (payload.role === 'admin') {
      if (payload.sub !== 0) throw new UnauthorizedException();
      if (!adminAccess) throw new ForbiddenException('Admin access only');
      request.user = {
        id: 0,
        phoneNumber: '',
        displayName: 'Administrator',
        role: 'admin',
      };
    } else {
      if (!Number.isSafeInteger(payload.sub) || payload.sub < 1) {
        throw new UnauthorizedException();
      }
      if (adminAccess === 'only') {
        throw new ForbiddenException('Admin access only');
      }
      const sessionVersion = await this.usersService.sessionVersion(payload.sub);
      if (sessionVersion === null || sessionVersion !== (payload.sessionVersion ?? 0)) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      request.user = {
        id: payload.sub,
        phoneNumber: payload.phoneNumber,
        displayName: payload.displayName,
        role: 'player',
      };
      // Presence heartbeat: fire-and-forget so the request keeps its latency.
      void this.usersService.touch(payload.sub);
    }

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    // The scheme is case-insensitive (RFC 7235), so `bearer` is as valid as
    // `Bearer` — the token itself is what has to be right.
    return type?.toLowerCase() === 'bearer' ? token : undefined;
  }
}
