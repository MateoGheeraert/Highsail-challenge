import { useCallback, useState } from "react";
import { Pressable, SectionList, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  AppIcon,
  IconButton,
  Button,
  Notice,
  Screen,
  Text,
} from "@/components";
import { jobsApi, type JobSummary } from "@/features/jobs/api";
import { completedLabel, scheduledLabel } from "@/features/jobs/dates";
import { colors } from "@/theme/tokens";

export default function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError("");
      jobsApi
        .list()
        .then((data) => {
          if (active) setJobs(data);
        })
        .catch((error) => {
          if (active) setError(error.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [attempt]),
  );
  const todo = jobs
    .filter((job) => !job.jobCompletedAt)
    .sort(
      (a, b) =>
        (a.scheduledAt ?? "9999").localeCompare(b.scheduledAt ?? "9999") ||
        a.title.localeCompare(b.title),
    );
  const completed = jobs
    .filter((job) => job.jobCompletedAt)
    .sort((a, b) => b.jobCompletedAt!.localeCompare(a.jobCompletedAt!));
  const sections =
    loading || error
      ? []
      : [
          { title: "To do", data: todo, empty: "No jobs to do." },
          {
            title: "Completed",
            data: completed,
            empty: "No completed jobs yet.",
          },
        ];
  return (
    <Screen scrollable={false}>
      <View
        style={{
          paddingHorizontal: 24,
          paddingTop: 20,
          paddingBottom: 20,
          gap: 20,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ gap: 4 }}>
            <Text variant="title" style={{ fontWeight: "700" }}>
              Jobs
            </Text>
            <Text variant="caption" muted>
              {loading
                ? "Loading..."
                : todo.length + " to do ? " + completed.length + " completed"}
            </Text>
          </View>
          <IconButton
            icon="cog-outline"
            label="Settings"
            onPress={() => router.push("/settings")}
          />
        </View>
        <Button icon="plus" onPress={() => router.push("/jobs/new")}>
          New job
        </Button>
      </View>
      <SectionList
        style={{ flex: 1 }}
        sections={sections}
        keyExtractor={(job) => job.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 32 }}
        ListHeaderComponent={
          error ? (
            <View style={{ gap: 12, paddingVertical: 16 }}>
              <Notice>{error}</Notice>
              <Button
                variant="secondary"
                onPress={() => setAttempt((value) => value + 1)}
              >
                Try again
              </Button>
            </View>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <View
            style={{
              backgroundColor: colors.background,
              paddingTop: 16,
              paddingBottom: 12,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
            >
              <Text
                variant="heading"
                style={{ fontSize: 18, fontWeight: "600" }}
              >
                {section.title}
              </Text>
              <View
                style={{
                  backgroundColor: colors.primarySoft,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 6,
                }}
              >
                <Text variant="caption">{section.data.length}</Text>
              </View>
            </View>
            <View
              style={{
                height: 2,
                backgroundColor: colors.border,
                marginTop: 12,
              }}
            />
          </View>
        )}
        ItemSeparatorComponent={() => (
          <View
            style={{
              height: 1,
              backgroundColor: colors.border,
              marginVertical: 6,
            }}
          />
        )}
        renderSectionFooter={({ section }) => (
          <View
            style={{
              paddingBottom: 24,
              paddingTop: section.data.length ? 0 : 12,
            }}
          >
            {!section.data.length && <Text muted>{section.empty}</Text>}
          </View>
        )}
        renderItem={({ item: job }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              job.title +
              ". " +
              (job.jobCompletedAt ? "Completed" : "To do") +
              ". " +
              scheduledLabel(job.scheduledAt)
            }
            onPress={() => router.push("/jobs/" + job.id)}
            style={({ pressed }) => ({
              paddingVertical: 18,
              paddingHorizontal: 14,
              backgroundColor: pressed ? colors.primarySoft : colors.surface,
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              borderRadius: 6,
            })}
          >
            <AppIcon
              name={
                job.jobCompletedAt ? "check-circle-outline" : "circle-outline"
              }
              color={job.jobCompletedAt ? colors.primary : colors.muted}
            />
            <View style={{ flex: 1, gap: 8 }}>
              <Text
                variant="label"
                style={{
                  fontSize: 16,
                  fontWeight: "600",
                  color: job.jobCompletedAt ? colors.muted : colors.ink,
                }}
              >
                {job.title}
              </Text>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
              >
                <AppIcon name="calendar-blank-outline" size={16} />
                <Text variant="caption" muted>
                  {scheduledLabel(job.scheduledAt)}
                </Text>
              </View>
              {job.priority && (
                <Text variant="caption" muted>
                  {job.priority.charAt(0).toUpperCase() + job.priority.slice(1)}{" "}
                  priority
                </Text>
              )}
              {job.jobCompletedAt && (
                <Text variant="caption" muted>
                  Completed {completedLabel(job.jobCompletedAt)}
                </Text>
              )}
            </View>
            <AppIcon name="chevron-right" size={20} />
          </Pressable>
        )}
      />
    </Screen>
  );
}
