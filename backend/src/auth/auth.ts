import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { expo } from '@better-auth/expo';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { AppConfig } from '../config.js';

export function createAuth(prisma: PrismaClient, config: AppConfig) {
  return betterAuth({
    appName: 'Formcast',
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: config.BETTER_AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: 'postgresql', transaction: true }),
    trustedOrigins: config.TRUSTED_ORIGINS,
    emailAndPassword: { enabled: true, minPasswordLength: 12 },
    plugins: [expo()],
    // Keep the same origin/CSRF protection in tests as in development and production.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    rateLimit: { enabled: true },
  });
}

export const AUTH = Symbol('AUTH');
export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth['$Infer']['Session'];
