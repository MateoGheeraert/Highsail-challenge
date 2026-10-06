import { goBack } from "@/lib/navigation";
import { router } from "expo-router";
import { Screen } from "@/components";
import { JobForm } from "@/features/jobs/job-form";
import { jobsApi } from "@/features/jobs/api";

export default function NewJob() {
  return (
    <Screen>
      <JobForm
        onCancel={() => goBack()}
        onSave={async (value) => {
          const job = await jobsApi.create(value);
          router.replace(`/jobs/${job.id}`);
        }}
      />
    </Screen>
  );
}
