import { goBack } from "@/lib/navigation";
import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Button, IconButton, Notice, Screen, Text } from "@/components";
import { jobsApi, type Job } from "@/features/jobs/api";
import { JobForm } from "@/features/jobs/job-form";
import { completedLabel, scheduledLabel } from "@/features/jobs/dates";
import { JobValues } from "@/features/jobs/job-values";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError("");
      jobsApi
        .get(id)
        .then((data) => {
          if (active) setJob(data);
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
    }, [id, refresh]),
  );
  async function remove() {
    setDeleting(true);
    setError("");
    try {
      await jobsApi.delete(id);
      router.dismissTo("/");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not delete job.",
      );
    } finally {
      setDeleting(false);
    }
  }
  return (
    <Screen>
      <View style={{ gap: 24 }}>
        {!editing && (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <IconButton
              icon="arrow-left"
              label="Back to jobs"
              disabled={deleting}
              onPress={() => goBack()}
            />
            {job && !loading && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <IconButton
                  icon="pencil-outline"
                  label="Edit job"
                  disabled={deleting}
                  onPress={() => {
                    setConfirmDelete(false);
                    setEditing(true);
                  }}
                />
                <IconButton
                  icon="trash-can-outline"
                  label="Delete job"
                  destructive
                  disabled={deleting}
                  onPress={() => setConfirmDelete(true)}
                />
              </View>
            )}
          </View>
        )}
        {confirmDelete && job ? (
          <View className="gap-3">
            <Notice>
              Delete this job and all its saved details? This cannot be undone.
            </Notice>
            <Button
              icon="trash-can-outline"
              loading={deleting}
              onPress={remove}
            >
              Delete permanently
            </Button>
            <Button
              variant="text"
              disabled={deleting}
              onPress={() => setConfirmDelete(false)}
            >
              Keep job
            </Button>
          </View>
        ) : null}
        {error ? (
          <View className="gap-2">
            <Notice>{error}</Notice>
            <Button
              variant="secondary"
              onPress={() => setRefresh((value) => value + 1)}
            >
              Retry
            </Button>
          </View>
        ) : null}
        {loading ? (
          <Text muted>Loading job...</Text>
        ) : job ? (
          editing ? (
            <>
              <JobForm
                initial={job}
                onCancel={() => setEditing(false)}
                onSave={async (value) => {
                  setJob(await jobsApi.update(id, value));
                  setEditing(false);
                }}
              />
            </>
          ) : (
            <>
              <Text variant="title">{job.title}</Text>
              <Text muted>
                {job.jobCompletedAt
                  ? `Completed ${completedLabel(job.jobCompletedAt)}`
                  : "To do"}{" "}
                · {job.priority ? `${job.priority} priority` : "No priority"}
              </Text>
              <Text muted>
                {job.scheduledAt
                  ? `Scheduled ${scheduledLabel(job.scheduledAt)}`
                  : "Unscheduled"}
              </Text>
              <JobValues job={job} />
              <Button
                disabled={deleting}
                onPress={() => router.push(`/jobs/${id}/speak`)}
              >
                Open speaking screen
              </Button>
            </>
          )
        ) : null}
      </View>
    </Screen>
  );
}
