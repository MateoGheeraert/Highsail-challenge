import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { AUTH, type Auth, type AuthSession } from "./auth.js";
import { APP_CONFIG, type AppConfig } from "../config.js";

export type AuthenticatedRequest = Request & { authSession: AuthSession };

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (
        (origin && !this.config.TRUSTED_ORIGINS.includes(origin)) ||
        (request.headers["sec-fetch-site"] === "cross-site" && !origin)
      ) {
        throw new ForbiddenException("Untrusted request origin");
      }
      if (request.method !== "DELETE" && !request.is("application/json"))
        throw new ForbiddenException("JSON body required");
    }
    const session = await this.auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
    });
    if (!session) throw new UnauthorizedException("Sign in to continue");
    request.authSession = session;
    return true;
  }
}
