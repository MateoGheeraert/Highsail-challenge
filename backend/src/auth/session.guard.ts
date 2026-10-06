import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { AUTH, type Auth, type AuthSession } from './auth.js';

export type AuthenticatedRequest = Request & { authSession: AuthSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) throw new UnauthorizedException('Sign in to continue');
    request.authSession = session;
    return true;
  }
}
