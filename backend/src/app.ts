import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { AUTH, type Auth } from './auth/auth.js';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  app.enableCors({ origin: config.TRUSTED_ORIGINS.filter((origin) => /^https?:\/\//.test(origin)), credentials: true });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  // Better Auth must receive the unconsumed request body.
  app.getHttpAdapter().getInstance().all('/api/auth/{*splat}', toNodeHandler(app.get<Auth>(AUTH)));
  app.useBodyParser('json', { limit: '64kb' });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  return app;
}
