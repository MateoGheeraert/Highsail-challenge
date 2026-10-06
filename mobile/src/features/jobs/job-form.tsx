import { useRef, useState } from "react";
import { View } from "react-native";
import {
  Button,
  DateField,
  IconButton,
  Notice,
  Text,
  TextField,
} from "@/components";
import type { JobInput } from "./api";
import { localDateTime, parseLocalDateTime } from "./dates";
import { colors } from "@/theme/tokens";

type MaterialDraft = {
  key: string;
  id?: string;
  material: string;
  quantity: string;
  unit: "m" | "pcs";
};
const sectionStyle = {
  gap: 16,
  paddingTop: 24,
  borderTopWidth: 1,
  borderColor: colors.border,
};

export function JobForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: JobInput;
  onSave: (value: JobInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<JobInput>({
    title: initial?.title ?? "",
    generalRemarks: initial?.generalRemarks ?? "",
    priority: initial?.priority ?? null,
    scheduledAt: initial?.scheduledAt?.slice(0, 10) ?? null,
    jobCompletedAt: initial?.jobCompletedAt ?? null,
  });
  const initialLocal = initial?.jobCompletedAt
    ? localDateTime(initial.jobCompletedAt)
    : "";
  const [completedDate, setCompletedDate] = useState<string | null>(
    initialLocal.slice(0, 10) || null,
  );
  const [completedTime, setCompletedTime] = useState(
    initialLocal.slice(11) || "",
  );
  const [materials, setMaterials] = useState<MaterialDraft[]>(() =>
    (initial?.materials ?? []).map((row, i) => ({
      ...row,
      key: String(i),
      quantity: String(row.quantity),
    })),
  );
  const nextKey = useRef(materials.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function updateMaterial(key: string, patch: Partial<MaterialDraft>) {
    setMaterials((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }
  async function save() {
    setError("");
    if (!value.title.trim()) {
      setError("Enter a job title.");
      return;
    }
    const completedText = completedDate
      ? `${completedDate} ${completedTime}`
      : "";
    const completed = completedText ? parseLocalDateTime(completedText) : null;
    if (completedText && !completed) {
      setError("Enter a valid completion time as HH:mm.");
      return;
    }
    for (const [i, row] of materials.entries()) {
      const quantity = row.quantity.trim().replace(",", ".");
      if (
        !row.material.trim() ||
        !/^\d+(\.\d+)?$/.test(quantity) ||
        !Number.isFinite(Number(quantity))
      ) {
        setError(
          `Material ${i + 1}: enter a name and a quantity of zero or more.`,
        );
        return;
      }
    }
    setBusy(true);
    try {
      await onSave({
        ...value,
        title: value.title.trim(),
        generalRemarks: value.generalRemarks?.trim() || null,
        jobCompletedAt:
          initial?.jobCompletedAt && completedText === initialLocal
            ? initial.jobCompletedAt
            : completed,
        materials: materials.map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          material: row.material.trim(),
          quantity: Number(row.quantity.trim().replace(",", ".")),
          unit: row.unit,
        })),
      });
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not save the job. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={{ gap: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <IconButton
          icon="arrow-left"
          label={initial ? "Cancel editing" : "Back to jobs"}
          disabled={busy}
          onPress={onCancel}
        />
        <Text variant="title">{initial ? "Edit job" : "New job"}</Text>
      </View>
      <View style={sectionStyle}>
        <Text variant="heading">Details</Text>
        <TextField
          label="Job title"
          value={value.title}
          maxLength={160}
          disabled={busy}
          onChangeText={(title) => setValue({ ...value, title })}
        />
        <TextField
          label="Remarks"
          value={value.generalRemarks ?? ""}
          multiline
          maxLength={5000}
          disabled={busy}
          onChangeText={(generalRemarks) =>
            setValue({ ...value, generalRemarks })
          }
        />
        <Text variant="label">Priority</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {([null, "low", "medium", "high"] as const).map((priority) => (
            <Button
              key={priority ?? "none"}
              disabled={busy}
              variant={value.priority === priority ? "primary" : "secondary"}
              onPress={() => setValue({ ...value, priority })}
            >
              {priority
                ? priority.charAt(0).toUpperCase() + priority.slice(1)
                : "None"}
            </Button>
          ))}
        </View>
      </View>
      <View style={sectionStyle}>
        <Text variant="heading">Dates</Text>
        <DateField
          label="Scheduled date (optional)"
          value={value.scheduledAt}
          disabled={busy}
          onChange={(scheduledAt) => setValue({ ...value, scheduledAt })}
        />
        <DateField
          label="Completion date (optional)"
          value={completedDate}
          disabled={busy}
          onChange={(date) => {
            setCompletedDate(date);
            if (date && !completedTime)
              setCompletedTime(
                localDateTime(new Date().toISOString()).slice(11),
              );
          }}
        />
        {completedDate && (
          <TextField
            label="Completion time"
            value={completedTime}
            maxLength={5}
            hint="HH:mm · 24-hour local time"
            disabled={busy}
            keyboardType="numbers-and-punctuation"
            onChangeText={setCompletedTime}
          />
        )}
        <Button
          icon={completedDate ? "undo" : "check"}
          variant="text"
          disabled={busy}
          onPress={() => {
            if (completedDate) setCompletedDate(null);
            else {
              const now = localDateTime(new Date().toISOString());
              setCompletedDate(now.slice(0, 10));
              setCompletedTime(now.slice(11));
            }
          }}
        >
          {completedDate ? "Mark as to do" : "Completed now"}
        </Button>
      </View>
      <View style={sectionStyle}>
        <Text variant="heading">Materials used</Text>
        {!materials.length && <Text muted>No materials added.</Text>}
        {materials.map((row, i) => (
          <View
            key={row.key}
            style={{
              gap: 12,
              padding: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text variant="label">Material {i + 1}</Text>
              <IconButton
                icon="trash-can-outline"
                label={`Remove material ${i + 1}`}
                destructive
                disabled={busy}
                onPress={() =>
                  setMaterials((rows) =>
                    rows.filter((item) => item.key !== row.key),
                  )
                }
              />
            </View>
            <TextField
              label="Material name"
              value={row.material}
              maxLength={200}
              disabled={busy}
              onChangeText={(material) => updateMaterial(row.key, { material })}
            />
            <TextField
              label="Quantity"
              value={row.quantity}
              keyboardType="decimal-pad"
              disabled={busy}
              onChangeText={(quantity) => updateMaterial(row.key, { quantity })}
            />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {(["m", "pcs"] as const).map((unit) => (
                <Button
                  key={unit}
                  disabled={busy}
                  variant={row.unit === unit ? "primary" : "secondary"}
                  onPress={() => updateMaterial(row.key, { unit })}
                >
                  {unit === "m" ? "Metres (m)" : "Pieces (pcs)"}
                </Button>
              ))}
            </View>
          </View>
        ))}
        <Button
          icon="plus"
          variant="secondary"
          disabled={busy || materials.length >= 100}
          onPress={() =>
            setMaterials((rows) => [
              ...rows,
              {
                key: String(nextKey.current++),
                material: "",
                quantity: "",
                unit: "pcs",
              },
            ])
          }
        >
          Add material
        </Button>
        <Text variant="caption" muted>
          Material changes are saved when you save the job.
        </Text>
      </View>
      {error ? <Notice>{error}</Notice> : null}
      <View style={sectionStyle}>
        <Button icon="check" loading={busy} onPress={save}>
          {initial ? "Save changes" : "Create job"}
        </Button>
        <Button variant="text" disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
      </View>
    </View>
  );
}
