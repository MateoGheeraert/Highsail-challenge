import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from '../config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const schema = new URL(config.DATABASE_URL).searchParams.get('schema') ?? 'public';
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL, connectionTimeoutMillis: 15_000 }, { schema }) });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
