import type { Job } from "@/features/jobs/api";

export type FieldKey =
  "arrivalTime" | "distanceKm" | "generalRemarks" | "priority" | "tags";
export type Proposal = {
  fieldOps: {
    op: "set" | "clear";
    fieldKey: FieldKey;
    value: string | number | boolean | string[] | null;
  }[];
  lineOps: {
    op: "create" | "update" | "delete";
    groupKey: "materials";
    lineId: string;
    values: {
      material: string | null;
      quantity: number | null;
      unit: "m" | "pcs" | null;
    } | null;
  }[];
  issues: string[];
};
export const emptyProposal = (): Proposal => ({
  fieldOps: [],
  lineOps: [],
  issues: [],
});
export type VoiceEvent = { sessionId: string } & (
  | { type: "connected"; snapshot: Job }
  | { type: "listening" | "draining" | "canceled" }
  | { type: "thinking"; active: boolean }
  | { type: "transcript"; final: string; interim: string; revision: number }
  | { type: "proposals"; proposal: Proposal; revision: number }
  | { type: "ready"; proposal: Proposal; revision: number }
  | { type: "warning" | "error"; message: string }
  | { type: "committed"; job: Job }
);
