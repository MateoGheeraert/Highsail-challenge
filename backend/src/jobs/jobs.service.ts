import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { parseJobInput } from './job-input.js';

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, body: unknown) {
    const data = parseJobInput(body);
    return this.prisma.job.create({ data: { ...data, title: data.title!, ownerId } });
  }

  async update(ownerId: string, id: string, body: unknown) {
    const data = parseJobInput(body, true);
    return this.prisma.$transaction(async tx => {
      const result = await tx.job.updateMany({ where: { id, ownerId }, data: { ...data, version: { increment: 1 } } });
      if (!result.count) throw new NotFoundException('Job not found');
      return tx.job.findUniqueOrThrow({ where: { id } });
    });
  }

  async delete(ownerId: string, id: string) {
    const result = await this.prisma.job.deleteMany({ where: { id, ownerId } });
    if (!result.count) throw new NotFoundException('Job not found');
  }

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
