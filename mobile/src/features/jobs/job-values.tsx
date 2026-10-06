import { View } from "react-native";
import { Text } from "@/components";
import { colors } from "@/theme/tokens";
import type { Job, Material } from "./api";
import type { Proposal, FieldKey } from "@/features/voice/types";

const labels: Record<FieldKey, string> = {
  arrivalTime: "Arrival time",
  distanceKm: "Distance travelled (km)",
  generalRemarks: "General remarks",
  priority: "Priority",
  tags: "Tags",
};
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (Array.isArray(value)) return value.join(", ") || "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
const proposedStyle = {
  borderWidth: 1,
  borderStyle: "dashed" as const,
  borderColor: colors.proposed,
  backgroundColor: colors.proposedSoft,
};

export function JobValues({
  job,
  proposal,
}: {
  job: Job;
  proposal?: Proposal;
}) {
  const rows: Array<{
    id: string;
    original?: Material;
    op?: Proposal["lineOps"][number];
  }> = (job.materials || []).map((row) => ({
    id: row.id,
    original: row,
    op: proposal?.lineOps.find((op) => op.lineId === row.id),
  }));
  for (const op of proposal?.lineOps || [])
    if (op.op === "create") rows.push({ id: op.lineId, op });
  return (
    <View className='gap-4'>
      {(Object.keys(labels) as FieldKey[]).map((key) => {
        const op = proposal?.fieldOps.find((op) => op.fieldKey === key);
        return (
          <View
            key={key}
            className='gap-1 p-4'
            style={[
              { borderRadius: 12, backgroundColor: colors.surface },
              op && proposedStyle,
            ]}
          >
            <Text variant='label'>{labels[key]}</Text>
            {op ? (
              <>
                <Text variant='caption' style={{ color: colors.proposed }}>
                  Proposed ·{" "}
                  {op.op === "clear"
                    ? "Clear"
                    : job[key] == null ||
                        (Array.isArray(job[key]) && !job[key].length)
                      ? "Set"
                      : "Update"}
                </Text>
                <Text>{display(op.value)}</Text>
                <Text variant='caption' muted>
                  Saved: {display(job[key])}
                </Text>
              </>
            ) : (
              <Text>{display(job[key])}</Text>
            )}
          </View>
        );
      })}
      <Text variant='heading'>Materials used</Text>
      {!rows.length && <Text muted>No materials yet.</Text>}
      {rows.map(({ id, original, op }) => {
        const values = op?.values || original;
        return (
          <View
            key={id}
            className='gap-1 p-4'
            style={[
              { borderRadius: 12, backgroundColor: colors.surface },
              op && proposedStyle,
            ]}
          >
            {op && (
              <Text variant='caption' style={{ color: colors.proposed }}>
                Proposed ·{" "}
                {op.op === "create"
                  ? "Create"
                  : op.op === "delete"
                    ? "Delete"
                    : "Update"}
              </Text>
            )}
            <Text
              style={
                op?.op === "delete"
                  ? { textDecorationLine: "line-through" }
                  : undefined
              }
            >
              {display(values?.material)} · {display(values?.quantity)}{" "}
              {values?.unit || "(unit missing)"}
            </Text>
            {op?.op === "update" && (
              <Text variant='caption' muted>
                Saved: {original?.material} · {original?.quantity}{" "}
                {original?.unit}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
