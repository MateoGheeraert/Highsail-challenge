import { View } from "react-native";
import { router } from "expo-router";
import { Screen, Text } from "@/components";
import { JobForm } from "@/features/jobs/job-form";
import { jobsApi } from "@/features/jobs/api";

export default function NewJob() {
  return (
    <Screen>
      <View className="gap-6">
        <Text variant="title">New job</Text>
        <Text muted>
          Give your job a name. You can update the details anytime.
        </Text>
        <JobForm
          onCancel={() => router.replace("/")}
          onSave={async (value) => {
            const job = await jobsApi.create(value);
            router.replace(`/jobs/${job.id}`);
          }}
        />
      </View>
    </Screen>
  );
}
