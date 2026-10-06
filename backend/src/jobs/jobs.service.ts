import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";
import { parseJobInput } from "./job-input.js";
import { normalizeProposal, type Proposal } from "./proposals.js";
import type { Prisma } from "../generated/prisma/client.js";

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  async commitProposal(
    ownerId: string,
    id: string,
    version: number,
    input: Proposal,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const base = await tx.job.findFirst({
        where: { id, ownerId },
        include: { materials: true },
      });
      if (!base) throw new NotFoundException("Job not found");
      if (base.version !== version)
        throw new ConflictException(
          "This job changed. Cancel and start again with the latest saved values.",
        );
      const proposal = normalizeProposal(input, base);
      if (proposal.issues.length)
        throw new BadRequestException(proposal.issues.join(" "));
      const data: Prisma.JobUpdateManyMutationInput = {
        version: { increment: 1 },
      };
      for (const op of proposal.fieldOps)
        Object.assign(data, { [op.fieldKey]: op.value });
      const changed = await tx.job.updateMany({
        where: { id, ownerId, version },
        data,
      });
      if (!changed.count)
        throw new ConflictException(
          "This job changed. Cancel and start again.",
        );
      let position =
        Math.max(-1, ...base.materials.map((row) => row.position)) + 1;
      for (const op of proposal.lineOps) {
        if (op.op === "delete")
          await tx.material.deleteMany({ where: { id: op.lineId, jobId: id } });
        else {
          const values = {
            material: op.values!.material!,
            quantity: op.values!.quantity!,
            unit: op.values!.unit!,
          };
          if (op.op === "create")
            await tx.material.create({
              data: { ...values, jobId: id, position: position++ },
            });
          else
            await tx.material.updateMany({
              where: { id: op.lineId, jobId: id },
              data: values,
            });
        }
      }
      return tx.job.findUniqueOrThrow({
        where: { id },
        include: {
          materials: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        },
      });
    });
  }

  create(ownerId: string, body: unknown) {
    const { materials, ...data } = parseJobInput(body);
    if (materials?.some((row) => row.id))
      throw new BadRequestException(
        "New materials must not have an existing ID",
      );
    return this.prisma.job.create({
      data: {
        ...data,
        title: data.title!,
        ownerId,
        materials: {
          create: materials?.map((row, position) => ({ ...row, position })),
        },
      },
      include: { materials: true },
    });
  }

  async update(ownerId: string, id: string, body: unknown) {
    const { materials, ...data } = parseJobInput(body, true);
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.job.updateMany({
        where: { id, ownerId },
        data: { ...data, version: { increment: 1 } },
      });
      if (!result.count) throw new NotFoundException("Job not found");
      if (materials !== undefined) {
        const ids = materials.flatMap((row) => (row.id ? [row.id] : []));
        if (new Set(ids).size !== ids.length)
          throw new BadRequestException("Duplicate material IDs");
        const existing = await tx.material.count({
          where: { jobId: id, id: { in: ids } },
        });
        if (existing !== ids.length)
          throw new BadRequestException("Material does not belong to this job");
        await tx.material.deleteMany({
          where: { jobId: id, id: { notIn: ids } },
        });
        for (const [position, row] of materials.entries()) {
          const { id: materialId, ...values } = row;
          if (materialId)
            await tx.material.update({
              where: { id: materialId },
              data: { ...values, position },
            });
          else
            await tx.material.create({
              data: { ...values, position, jobId: id },
            });
        }
      }
      return tx.job.findUniqueOrThrow({
        where: { id },
        include: {
          materials: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        },
      });
    });
  }

  async delete(ownerId: string, id: string) {
    const result = await this.prisma.job.deleteMany({ where: { id, ownerId } });
    if (!result.count) throw new NotFoundException("Job not found");
  }

  list(ownerId: string) {
    return this.prisma.job.findMany({
      where: { ownerId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        jobCompletedAt: true,
        priority: true,
        version: true,
        updatedAt: true,
      },
    });
  }

  async get(ownerId: string, id: string) {
    const job = await this.prisma.job.findFirst({
      where: { id, ownerId },
      include: { materials: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    if (!job) throw new NotFoundException("Job not found");
    return job;
  }
}
