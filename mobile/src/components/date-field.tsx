import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { AppIcon, Button, IconButton, Text } from "./ui";
import { colors } from "@/theme/tokens";

const pad = (n: number) => String(n).padStart(2, "0");
export function dateInputLabel(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

// Date-only strings keep calendar selections independent of timezone.
export function DateField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(new Date());
  const year = month.getFullYear();
  const index = month.getMonth();
  const offset = (new Date(year, index, 1).getDay() + 6) % 7;
  const days = new Date(year, index + 1, 0).getDate();
  function show() {
    setMonth(value ? new Date(`${value.slice(0, 10)}T12:00:00`) : new Date());
    setOpen(true);
  }
  return (
    <View style={{ gap: 8 }}>
      <Text variant="label">{label}</Text>
      <Pressable
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ? dateInputLabel(value) : "Choose date"}`}
        onPress={show}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          minHeight: 56,
          paddingHorizontal: 16,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: colors.surface,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text muted={!value}>
          {value ? dateInputLabel(value) : "dd/mm/yyyy"}
        </Text>
        <AppIcon name="calendar-blank-outline" />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "#00000066",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <View
            accessibilityViewIsModal
            style={{
              width: "100%",
              maxWidth: 400,
              alignSelf: "center",
              padding: 20,
              gap: 16,
              borderRadius: 20,
              backgroundColor: colors.surface,
            }}
          >
            <Text variant="heading">{label}</Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <IconButton
                icon="chevron-left"
                label="Previous month"
                onPress={() => setMonth(new Date(year, index - 1, 1))}
              />
              <Text variant="label">
                {month.toLocaleDateString("en-GB", {
                  month: "long",
                  year: "numeric",
                })}
              </Text>
              <IconButton
                icon="chevron-right"
                label="Next month"
                onPress={() => setMonth(new Date(year, index + 1, 1))}
              />
            </View>
            <View style={{ flexDirection: "row" }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                <View
                  key={i}
                  style={{ width: "14.2857%", alignItems: "center" }}
                >
                  <Text variant="caption" muted>
                    {day}
                  </Text>
                </View>
              ))}
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {Array.from(
                { length: Math.ceil((offset + days) / 7) * 7 },
                (_, i) => {
                  const day = i - offset + 1;
                  const key = `${year}-${pad(index + 1)}-${pad(day)}`;
                  const selected = value?.slice(0, 10) === key;
                  return day < 1 || day > days ? (
                    <View key={i} style={{ width: "14.2857%", height: 44 }} />
                  ) : (
                    <Pressable
                      key={i}
                      accessibilityRole="button"
                      accessibilityLabel={dateInputLabel(key)}
                      accessibilityState={{ selected }}
                      onPress={() => {
                        onChange(key);
                        setOpen(false);
                      }}
                      style={{
                        width: "14.2857%",
                        minHeight: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: 8,
                        backgroundColor: selected
                          ? colors.primary
                          : colors.surface,
                      }}
                    >
                      <Text
                        style={{
                          color: selected ? colors.surface : colors.ink,
                        }}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  );
                },
              )}
            </View>
            <View
              style={{ flexDirection: "row", justifyContent: "space-between" }}
            >
              <Button
                variant="text"
                onPress={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                Clear
              </Button>
              <Button variant="text" onPress={() => setOpen(false)}>
                Cancel
              </Button>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
