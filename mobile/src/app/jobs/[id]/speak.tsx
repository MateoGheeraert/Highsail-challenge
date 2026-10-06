import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { BrandMark, Button, Notice, Screen, Text } from "@/components";
import { jobsApi, type Job } from "@/features/jobs/api";
import { JobValues } from "@/features/jobs/job-values";
import { useVoiceSession } from "@/features/voice/use-voice-session";
import { colors } from "@/theme/tokens";

export default function Speak() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const voice = useVoiceSession(id);
  useEffect(() => {
    let active = true;
    setError("");
    jobsApi
      .get(id)
      .then((job) => {
        if (active) setJob(job);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  const base = voice.snapshot || job;
  const idle = ["idle", "error", "saved"].includes(voice.stage);
  const busy = ["starting", "stopping", "draining", "saving"].includes(
    voice.stage,
  );
  const labels = {
    idle: "Ready when you are",
    starting: "Connecting microphone…",
    listening: "Listening",
    stopping: "Finishing audio…",
    draining: "Processing your final words…",
    review: "Review remaining details",
    saving: "Saving your job…",
    saved: "Changes saved",
    error: "Speaking stopped",
  };
  return (
    <Screen>
      <View className="gap-6">
        <Button
          variant="text"
          disabled={!idle}
          onPress={() => router.replace(`/jobs/${id}`)}
        >
          Back to job
        </Button>
        {error ? (
          <>
            <Notice>{error}</Notice>
            <Button
              variant="secondary"
              onPress={() => setAttempt((value) => value + 1)}
            >
              Retry loading job
            </Button>
          </>
        ) : null}
        {base ? (
          <>
            <Text muted>{base.title}</Text>
            <Text variant="title">Speak your job notes</Text>
            <View
              className="gap-4 p-6"
              style={{ backgroundColor: colors.primarySoft, borderRadius: 24 }}
            >
              <BrandMark />
              <Text variant="heading">{labels[voice.stage]}</Text>
              <Text muted>
                {voice.stage === "saved"
                  ? "Your proposed changes are now saved to this job."
                  : "Describe your work and correct yourself naturally. Nothing is saved until you press Finish."}
              </Text>
              {voice.stage === "listening" && (
                <View
                  accessibilityLabel={`Microphone ${voice.level > 0.02 ? "detecting sound" : "quiet"}`}
                  style={{
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: colors.border,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      height: 8,
                      width: `${Math.max(3, Math.min(100, voice.level * 250))}%`,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
              )}
              {Platform.OS === "web" ? (
                <Text muted>
                  Open the iPhone or Android app to use live voice capture.
                </Text>
              ) : idle ? (
                <Button onPress={() => void voice.start()}>
                  {voice.stage === "saved" ? "Speak more" : "Start speaking"}
                </Button>
              ) : (
                <>
                  <Button
                    loading={busy}
                    disabled={
                      voice.proposal.issues.length > 0 ||
                      !["listening", "review"].includes(voice.stage)
                    }
                    onPress={() => void voice.finish()}
                  >
                    {voice.stage === "review" ? "Retry Finish" : "Finish"}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={voice.stage === "saving"}
                    onPress={() => void voice.cancel()}
                  >
                    Cancel · discard proposals
                  </Button>
                </>
              )}
            </View>
            {voice.error ? <Notice>{voice.error}</Notice> : null}
            {voice.warning ? <Notice>{voice.warning}</Notice> : null}
            {voice.proposal.issues.map((issue, index) => (
              <Notice key={`${index}:${issue}`}>{issue}</Notice>
            ))}
            {(voice.transcript.final || voice.transcript.interim || !idle) && (
              <View className="gap-2">
                <Text variant="label">Live transcript</Text>
                <Text>
                  {voice.transcript.final || "Your words will appear here."}
                </Text>
                {voice.transcript.interim ? (
                  <Text muted>{voice.transcript.interim}</Text>
                ) : null}
                <Text variant="caption" muted>
                  {voice.thinking
                    ? "Updating proposals…"
                    : "Corrections will update the proposed values below."}
                </Text>
              </View>
            )}
            <Text variant="heading">
              {idle ? "Job details" : "What will be saved"}
            </Text>
            <JobValues job={base} proposal={voice.proposal} />
          </>
        ) : !error ? (
          <Text muted>Loading job…</Text>
        ) : null}
      </View>
    </Screen>
  );
}
