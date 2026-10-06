import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { Button, Notice, Screen, Text } from "@/components";
import { jobsApi, type Job } from "@/features/jobs/api";
import { JobForm } from "@/features/jobs/job-form";
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
      router.replace("/");
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
      <View className="gap-6">
        {!editing && (
          <Button
            variant="text"
            disabled={deleting}
            onPress={() => router.replace("/")}
          >
            Back to jobs
          </Button>
        )}
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
              <Text variant="title">Edit job</Text>
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
                {job.jobComplete === true
                  ? "Complete"
                  : job.jobComplete === false
                    ? "In progress"
                    : "Not started"}{" "}
                · {job.priority ? `${job.priority} priority` : "No priority"}
              </Text>
              <JobValues job={job} />
              <Button
                disabled={deleting}
                onPress={() => router.push(`/jobs/${id}/speak`)}
              >
                Open speaking screen
              </Button>
              <Button
                variant="secondary"
                disabled={deleting}
                onPress={() => {
                  setConfirmDelete(false);
                  setEditing(true);
                }}
              >
                Edit job
              </Button>
              {confirmDelete ? (
                <View className="gap-3">
                  <Notice>
                    Delete this job and all its saved details? This cannot be
                    undone.
                  </Notice>
                  <Button loading={deleting} onPress={remove}>
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
              ) : (
                <Button variant="text" onPress={() => setConfirmDelete(true)}>
                  Delete job
                </Button>
              )}
            </>
          )
        ) : null}
      </View>
    </Screen>
  );
}
