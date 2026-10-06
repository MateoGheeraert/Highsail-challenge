import { z } from "zod";

export const fieldKeys = [
  "arrivalTime",
  "distanceKm",
  "generalRemarks",
  "priority",
  "tags",
] as const;
const tags = z
  .array(z.enum(["urgent", "warranty", "follow-up", "parts-needed"]))
  .max(4);
const validators = {
  arrivalTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  distanceKm: z.number().finite().min(0).nullable(),
  generalRemarks: z.string().max(5000).nullable(),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  tags,
};
export const materialValues = z
  .object({
    material: z.string().trim().min(1).max(200).nullable(),
    quantity: z.number().finite().min(0).nullable(),
    unit: z.enum(["m", "pcs"]).nullable(),
  })
  .strict();
// All properties are required for OpenAI strict structured output. Null denotes
// an intentionally empty scalar or an unfinished material cell, never omission.
export const proposalSchema = z
  .object({
    fieldOps: z
      .array(
        z
          .object({
            op: z.enum(["set", "clear"]),
            fieldKey: z.enum(fieldKeys),
            value: z.union([
              z.string(),
              z.number(),
              z.boolean(),
              z.array(z.string()),
              z.null(),
            ]),
          })
          .strict(),
      )
      .max(5),
    lineOps: z
      .array(
        z
          .object({
            op: z.enum(["create", "update", "delete"]),
            groupKey: z.literal("materials"),
            lineId: z.string().min(1).max(100),
            values: materialValues.nullable(),
          })
          .strict(),
      )
      .max(100),
    issues: z.array(z.string().max(300)).max(10),
  })
  .strict();
export type Proposal = z.infer<typeof proposalSchema>;
export type MaterialValues = z.infer<typeof materialValues>;
export type JobSnapshot = {
  id: string;
  version: number;
  title: string;
  arrivalTime: string | null;
  distanceKm: number | null;
  generalRemarks: string | null;
  scheduledAt: Date | string | null;
  jobCompletedAt: Date | string | null;
  priority: "low" | "medium" | "high" | null;
  tags: unknown;
  materials: Array<{
    id: string;
    material: string;
    quantity: number;
    unit: "m" | "pcs";
    position: number;
  }>;
};
export const emptyProposal = (): Proposal => ({
  fieldOps: [],
  lineOps: [],
  issues: [],
});

export function normalizeProposal(input: unknown, base: JobSnapshot): Proposal {
  const proposal = proposalSchema.parse(input);
  const fields = new Set<string>();
  proposal.fieldOps = proposal.fieldOps.filter((op) => {
    if (fields.has(op.fieldKey)) throw new Error("Duplicate field operation");
    fields.add(op.fieldKey);
    if (op.op === "clear") {
      const empty = op.fieldKey === "tags" ? [] : null;
      if (JSON.stringify(op.value) !== JSON.stringify(empty))
        throw new Error("Invalid clear value");
    }
    op.value = validators[op.fieldKey].parse(op.value);
    if (Array.isArray(op.value)) op.value = [...new Set(op.value)].sort();
    const original = Array.isArray(base[op.fieldKey])
      ? [...(base[op.fieldKey] as string[])].sort()
      : base[op.fieldKey];
    return JSON.stringify(original) !== JSON.stringify(op.value);
  });
  const ids = new Set<string>();
  proposal.lineOps = proposal.lineOps.filter((op) => {
    if (ids.has(op.lineId)) throw new Error("Duplicate material operation");
    ids.add(op.lineId);
    const original = base.materials.find((row) => row.id === op.lineId);
    if (op.op === "create") {
      if (!/^new:[a-zA-Z0-9_-]+$/.test(op.lineId) || original)
        throw new Error("Invalid proposed row identity");
    } else if (!original) throw new Error("Unknown material row");
    if (op.op === "delete") {
      if (op.values !== null) throw new Error("Delete must not contain values");
      return true;
    }
    if (!op.values) throw new Error("Material values required");
    if (Object.values(op.values).some((value) => value === null)) {
      proposal.issues.push(
        `Complete the material, quantity and unit for ${op.values.material || op.lineId}.`,
      );
    }
    return (
      !original ||
      ["material", "quantity", "unit"].some(
        (key) =>
          original[key as keyof MaterialValues] !==
          op.values![key as keyof MaterialValues],
      )
    );
  });
  proposal.issues = [...new Set(proposal.issues)];
  return proposal;
}

export function previewProposal(base: JobSnapshot, proposal: Proposal) {
  const preview = {
    ...base,
    materials: base.materials.map((row) => ({ ...row })) as Array<
      MaterialValues & { id: string; position: number }
    >,
  };
  for (const op of proposal.fieldOps)
    Object.assign(preview, { [op.fieldKey]: op.value });
  for (const op of proposal.lineOps) {
    if (op.op === "delete")
      preview.materials = preview.materials.filter(
        (row) => row.id !== op.lineId,
      );
    else if (op.op === "create")
      preview.materials.push({
        ...op.values!,
        id: op.lineId,
        position: preview.materials.length,
      });
    else
      preview.materials = preview.materials.map((row) =>
        row.id === op.lineId ? { ...row, ...op.values! } : row,
      );
  }
  return preview;
}
