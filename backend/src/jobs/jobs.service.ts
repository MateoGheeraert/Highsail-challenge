import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  list(ownerId: string) {
    return this.prisma.job.findMany({
      where: { ownerId }, orderBy: { createdAt: 'desc' },
      select: { id: true, title: true, jobComplete: true, priority: true, version: true, updatedAt: true },
    });
  }

  async get(ownerId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, ownerId },
      include: { materials: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}
