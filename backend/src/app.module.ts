import { Module } from '@nestjs/common';
import { APP_CONFIG, readConfig, type AppConfig } from './config.js';
import { PrismaService } from './database/prisma.service.js';
import { AUTH, createAuth } from './auth/auth.js';
import { SessionGuard } from './auth/session.guard.js';
import { MeController } from './auth/me.controller.js';
import { JobsController } from './jobs/jobs.controller.js';
import { JobsService } from './jobs/jobs.service.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController, MeController, JobsController],
  providers: [
    { provide: APP_CONFIG, useFactory: readConfig },
    PrismaService,
    { provide: AUTH, inject: [PrismaService, APP_CONFIG], useFactory: (prisma: PrismaService, config: AppConfig) => createAuth(prisma, config) },
    SessionGuard,
    JobsService,
  ],
})
export class AppModule {}
