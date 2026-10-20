import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UsersService } from '../users/users.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';

export interface AuthenticatedUser {
  id: number;
  phoneNumber: string;
  displayName: string;
}

interface JwtPayload {
  sub: number;
  phoneNumber: string;
  displayName: string;
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

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);
      request.user = {
        id: payload.sub,
        phoneNumber: payload.phoneNumber,
        displayName: payload.displayName,
      };
      // Presence heartbeat: fire-and-forget so the request keeps its latency.
      void this.usersService.touch(payload.sub);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
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
