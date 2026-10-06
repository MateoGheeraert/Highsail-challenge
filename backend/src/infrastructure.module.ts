import { Module } from "@nestjs/common";
import { APP_CONFIG, readConfig, type AppConfig } from "./config.js";
import { PrismaService } from "./database/prisma.service.js";
import { AUTH, createAuth } from "./auth/auth.js";
import { SessionGuard } from "./auth/session.guard.js";

@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: readConfig },
    PrismaService,
    {
      provide: AUTH,
      inject: [PrismaService, APP_CONFIG],
      useFactory: (prisma: PrismaService, config: AppConfig) =>
        createAuth(prisma, config),
    },
    SessionGuard,
  ],
  exports: [APP_CONFIG, PrismaService, AUTH, SessionGuard],
})
export class InfrastructureModule {}
