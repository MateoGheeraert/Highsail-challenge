import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

const fields = z
  .object({
    title: z.string().trim().min(1).max(160),
    generalRemarks: z.string().trim().max(5000).nullable().optional(),
    priority: z.enum(["low", "medium", "high"]).nullable().optional(),
    jobComplete: z.boolean().nullable().optional(),
  })
  .strict();

export function parseJobInput(body: unknown, partial = false) {
  const result = (
    partial
      ? fields.partial().refine((value) => Object.keys(value).length > 0)
      : fields
  ).safeParse(body);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "Job"}: ${issue.message}`)
        .join("; "),
    );
  return result.data;
}
