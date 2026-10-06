import { useCallback, useState } from "react";
import { View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { BrandMark, Button, Notice, Screen, Text } from "@/components";
import { authClient } from "@/lib/auth-client";
import { jobsApi, type JobSummary } from "@/features/jobs/api";
import { colors } from "@/theme/tokens";

export default function Jobs() {
  const { data: session } = authClient.useSession();
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [refresh, setRefresh] = useState(0);
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
    }, [refresh]),
  );
  async function signOut() {
    setSigningOut(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) setError("Could not sign out. Please try again.");
    } catch {
      setError("Could not reach Formcast. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }
  return (
    <Screen>
      <View className="gap-6">
        <BrandMark />
        <View className="gap-2">
          <Text muted>Hello, {session?.user.name}.</Text>
          <Text variant="title">Your jobs</Text>
          <Text muted>Create a job or pick up where you left off.</Text>
        </View>
        <Button onPress={() => router.push("/jobs/new")}>New job</Button>
        {error ? <Notice>{error}</Notice> : null}
        {loading ? (
          <Text muted>Loading jobs...</Text>
        ) : !error && jobs.length === 0 ? (
          <View className="gap-2">
            <Text variant="heading">Your first job starts here</Text>
            <Text muted>Add a title and a few details to get started.</Text>
          </View>
        ) : (
          jobs.map((job) => (
            <View
              key={job.id}
              className="gap-3 p-5"
              style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text variant="heading">{job.title}</Text>
              <Text muted>
                {job.jobComplete === true
                  ? "Complete"
                  : job.jobComplete === false
                    ? "In progress"
                    : "Not started"}{" "}
                · {job.priority ? `${job.priority} priority` : "No priority"}
              </Text>
              <Button
                variant="secondary"
                onPress={() => router.push(`/jobs/${job.id}`)}
              >
                Open job
              </Button>
            </View>
          ))
        )}
        <Button
          variant="text"
          disabled={loading}
          onPress={() => setRefresh((value) => value + 1)}
        >
          Refresh jobs
        </Button>
        <Button variant="text" onPress={signOut} loading={signingOut}>
          Sign out
        </Button>
      </View>
    </Screen>
  );
}
