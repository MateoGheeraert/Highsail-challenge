import { useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioStreamBuffer,
} from "expo-audio";
import { apiBase, apiRequest } from "@/lib/api";
import type { Job } from "@/features/jobs/api";
import { emptyProposal, type Proposal, type VoiceEvent } from "./types";

type Stage =
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
  | "draining"
  | "review"
  | "saving"
  | "saved"
  | "error";
type Session = { sessionId: string; ticket: string; snapshot: Job };
// TypeScript's DOM declaration omits React Native's documented headers option.
const NativeWebSocket = WebSocket as unknown as {
  new (
    url: string,
    protocols: string[],
    options: { headers: Record<string, string> },
  ): WebSocket;
};

export function useVoiceSession(jobId: string) {
  const [stage, setStage] = useState<Stage>("idle");
  const [snapshot, setSnapshot] = useState<Job | null>(null);
  const [proposalRevision, setProposalRevision] = useState(0);
  const [proposal, setProposal] = useState<Proposal>(emptyProposal);
  const [transcript, setTranscript] = useState({ final: "", interim: "" });
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [level, setLevel] = useState(0);
  const state = useRef({
    stage: "idle" as Stage,
    generation: 0,
    sessionId: "",
    revision: 0,
    transcriptRevision: 0,
    active: true,
    accepting: false,
    serverReady: false,
    format: "",
    buffers: [] as ArrayBuffer[],
    bytes: 0,
    lastBufferAt: 0,
    startedAt: 0,
    finalRevision: 0,
    hasSpeech: false,
    saving: false,
    saveAttempted: false,
    micStarting: undefined as Promise<void> | undefined,
    socket: null as WebSocket | null,
    watchdog: undefined as ReturnType<typeof setInterval> | undefined,
  });
  const handlers = useRef({
    buffer: (_buffer: AudioStreamBuffer) => {},
    interrupt: (_message: string) => {},
  });
  const { stream } = useAudioStream({
    encoding: "int16",
    channels: 1,
    sampleRate: 16_000,
    onBuffer: (buffer) => handlers.current.buffer(buffer),
  });

  function changeStage(next: Stage) {
    state.current.stage = next;
    if (state.current.active) setStage(next);
  }
  function stopMic() {
    state.current.accepting = false;
    try {
      stream?.stop();
    } catch {
      /* The OS may already have interrupted capture. */
    }
    clearInterval(state.current.watchdog);
    if (state.current.active) setLevel(0);
  }
  function closeSocket() {
    const socket = state.current.socket;
    state.current.socket = null;
    socket?.close();
  }
  async function cancelRemote(id: string) {
    if (id)
      await apiRequest(`/voice-sessions/${id}/cancel`, "POST", {}).catch(
        () => undefined,
      );
  }
  function fail(message: string) {
    const current = state.current;
    if (["idle", "saved", "error", "saving"].includes(current.stage)) return;
    current.generation++;
    stopMic();
    changeStage("error");
    closeSocket();
    void cancelRemote(current.sessionId);
    if (current.active) {
      setThinking(false);
      setError(message);
    }
  }
  handlers.current.interrupt = fail;

  function flushAudio() {
    const current = state.current;
    if (!current.serverReady || current.socket?.readyState !== WebSocket.OPEN)
      return;
    if (current.socket.bufferedAmount > 512_000)
      throw new Error(
        "The network is too slow for live audio. Cancel and try again.",
      );
    for (const data of current.buffers) {
      for (let offset = 0; offset < data.byteLength; offset += 32_000)
        current.socket.send(data.slice(offset, offset + 32_000));
    }
    current.buffers = [];
    current.bytes = 0;
  }

  handlers.current.buffer = (buffer) => {
    const current = state.current;
    if (!current.accepting || !current.socket) return;
    try {
      if (buffer.channels !== 1)
        throw new Error(
          "The microphone must provide mono audio. Please use the phone microphone.",
        );
      const format = `${buffer.sampleRate}:${buffer.channels}`;
      if (!current.format) {
        current.format = format;
        current.socket.send(
          JSON.stringify({
            type: "audio.start",
            encoding: "int16",
            sampleRate: buffer.sampleRate,
            channels: buffer.channels,
          }),
        );
      } else if (current.format !== format)
        throw new Error(
          "The audio device changed. Cancel and restart speaking.",
        );
      current.lastBufferAt = Date.now();
      current.buffers.push(buffer.data);
      current.bytes += buffer.data.byteLength;
      if (current.bytes > 512_000)
        throw new Error(
          "Audio could not reach the server. Cancel and try again.",
        );
      const samples = new Int16Array(buffer.data);
      let peak = 0;
      for (let i = 0; i < samples.length; i += 8)
        peak = Math.max(peak, Math.abs(samples[i]) / 32768);
      if (current.active) setLevel(peak);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Microphone capture failed.",
      );
    }
  };

  async function save(revision: number, generation: number) {
    const current = state.current;
    if (current.saving) return;
    current.saving = true;
    current.saveAttempted = true;
    changeStage("saving");
    setError("");
    try {
      const job = await apiRequest<Job>(
        `/voice-sessions/${current.sessionId}/finish`,
        "POST",
        { revision },
      );
      if (current.active && current.generation === generation) {
        setSnapshot(job);
        setProposal(emptyProposal());
        changeStage("saved");
        closeSocket();
      }
    } catch (error) {
      if (
        current.active &&
        current.generation === generation &&
        current.stage !== "saved"
      ) {
        changeStage("review");
        setError(
          `Save could not be confirmed. Retry Finish to check the same save. ${error instanceof Error ? error.message : ""}`,
        );
      }
    } finally {
      current.saving = false;
    }
  }

  async function start() {
    if (!["idle", "error", "saved"].includes(state.current.stage)) return;
    const current = state.current;
    const generation = ++current.generation;
    changeStage("starting");
    setError("");
    setWarning("");
    setProposal(emptyProposal());
    setProposalRevision(0);
    setTranscript({ final: "", interim: "" });
    setThinking(false);
    current.revision = 0;
    current.transcriptRevision = 0;
    current.finalRevision = 0;
    current.hasSpeech = false;
    current.saveAttempted = false;
    current.buffers = [];
    current.bytes = 0;
    current.format = "";
    current.serverReady = false;
    const valid = () => current.active && current.generation === generation;
    try {
      if (Platform.OS === "web")
        throw new Error(
          "Live voice capture is available in the iPhone and Android app.",
        );
      await current.micStarting;
      if (!valid()) return;
      const permission = await requestRecordingPermissionsAsync();
      if (!valid()) return;
      if (!permission.granted)
        throw new Error(
          "Allow microphone access in your phone settings, then try again.",
        );
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        allowsBackgroundRecording: false,
      });
      if (!valid()) return;
      const session = await apiRequest<Session>(
        `/jobs/${encodeURIComponent(jobId)}/voice-sessions`,
        "POST",
        {},
      );
      if (!valid()) {
        void cancelRemote(session.sessionId);
        return;
      }
      current.sessionId = session.sessionId;
      setSnapshot(session.snapshot);
      // Android otherwise defaults Origin to the backend HTTP address. Use the
      // same explicit app origin already trusted by Better Auth on both devices.
      const socket = new NativeWebSocket(
        `${apiBase.replace(/^http/, "ws")}/api/voice`,
        [],
        { headers: { Origin: "formcast://" } },
      );
      current.socket = socket;
      current.startedAt = Date.now();
      current.lastBufferAt = 0;
      socket.onopen = () => {
        if (valid())
          socket.send(
            JSON.stringify({
              type: "connect",
              sessionId: session.sessionId,
              ticket: session.ticket,
            }),
          );
      };
      socket.onerror = () => {
        if (valid())
          fail(
            "Could not connect to voice streaming. Check the backend and network.",
          );
      };
      socket.onclose = () => {
        if (
          valid() &&
          !["review", "saving", "saved", "idle", "error"].includes(
            current.stage,
          )
        )
          fail(
            "Voice connection lost. Nothing was saved. Cancel and try again.",
          );
      };
      socket.onmessage = (event) => {
        if (!valid()) return;
        try {
          const message = JSON.parse(String(event.data)) as VoiceEvent;
          if (message.type === "error") {
            fail(message.message);
            return;
          }
          if (message.sessionId !== current.sessionId) return;
          if (message.type === "connected") {
            current.accepting = true;
            current.micStarting = stream
              .start()
              .then(() => {
                if (!valid()) stream.stop();
              })
              .catch(() => {
                if (valid())
                  fail(
                    "Could not start the microphone. Check permissions and restart the app.",
                  );
              });
          } else if (message.type === "listening") {
            current.serverReady = true;
            flushAudio();
            changeStage("listening");
          } else if (
            message.type === "transcript" &&
            message.revision >= current.transcriptRevision
          ) {
            current.transcriptRevision = message.revision;
            current.hasSpeech = Boolean(message.final || message.interim);
            setTranscript({ final: message.final, interim: message.interim });
            setWarning("");
          } else if (
            message.type === "proposals" &&
            current.stage === "listening" &&
            message.revision >= current.revision
          ) {
            current.revision = message.revision;
            setProposalRevision(message.revision);
            setProposal(message.proposal);
            setWarning("");
          } else if (
            message.type === "thinking" &&
            current.stage === "listening"
          )
            setThinking(message.active);
          else if (message.type === "warning") setWarning(message.message);
          else if (message.type === "ready") {
            clearInterval(current.watchdog);
            setThinking(false);
            current.finalRevision = message.revision;
            setProposal(message.proposal);
            changeStage("review");
            void save(message.revision, generation);
          } else if (message.type === "committed") {
            setSnapshot(message.job);
            setProposal(emptyProposal());
            changeStage("saved");
            closeSocket();
          }
        } catch {
          fail(
            "An invalid streaming response was received. Nothing was saved.",
          );
        }
      };
      current.watchdog = setInterval(() => {
        if (!valid()) return;
        try {
          flushAudio();
          if (
            current.stage === "starting" &&
            Date.now() - current.startedAt > 20_000
          )
            fail("Timed out starting the microphone or speech connection.");
          if (current.stage === "listening") {
            if (Date.now() - current.lastBufferAt > 5000)
              fail("Microphone audio stopped. Cancel and try again.");
            else if (
              !current.hasSpeech &&
              Date.now() - current.startedAt > 8000
            )
              setWarning(
                "No speech detected yet. Check your microphone and speak a little closer.",
              );
          }
        } catch (error) {
          fail(
            error instanceof Error ? error.message : "Audio streaming failed.",
          );
        }
      }, 100);
    } catch (error) {
      if (valid())
        fail(
          error instanceof Error
            ? error.message
            : "Could not start voice capture.",
        );
    }
  }

  async function finish() {
    const current = state.current;
    if (current.stage === "review") {
      await save(current.finalRevision, current.generation);
      return;
    }
    if (current.stage !== "listening") return;
    changeStage("stopping");
    setWarning("");
    try {
      // Capture the revision rendered with this Finish handler, not a newer
      // socket event that React has not displayed yet.
      current.finalRevision = proposalRevision;
      stopMic();
      current.buffers = [];
      current.bytes = 0;
      setThinking(false);
      if (current.socket?.readyState !== WebSocket.OPEN)
        throw new Error(
          "Voice connection lost before Finish. Nothing was saved.",
        );
      changeStage("draining");
      current.socket.send(
        JSON.stringify({ type: "stop", revision: proposalRevision }),
      );
      current.startedAt = Date.now();
      current.watchdog = setInterval(() => {
        if (
          current.stage === "draining" &&
          Date.now() - current.startedAt > 75_000
        )
          fail("Timed out finishing speech. Nothing was saved.");
      }, 1000);
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not finish speech.");
    }
  }

  async function cancel() {
    const current = state.current;
    if (current.stage === "saving") return;
    // A timed-out HTTP response does not prove that saving failed. Require the
    // server to confirm cancellation before describing those proposals as discarded.
    if (current.saveAttempted) {
      try {
        await apiRequest(
          `/voice-sessions/${current.sessionId}/cancel`,
          "POST",
          {},
        );
      } catch {
        setError(
          "Could not confirm cancellation. Retry Finish to recover the save result, or reload the job to check its saved values.",
        );
        return;
      }
    }
    current.generation++;
    stopMic();
    if (current.socket?.readyState === WebSocket.OPEN && current.sessionId)
      current.socket.send(JSON.stringify({ type: "cancel" }));
    closeSocket();
    if (!current.saveAttempted) void cancelRemote(current.sessionId);
    current.sessionId = "";
    changeStage("idle");
    setProposal(emptyProposal());
    setTranscript({ final: "", interim: "" });
    setThinking(false);
    setError("");
    setWarning("");
  }

  useEffect(() => {
    state.current.active = true;
    const subscription = AppState.addEventListener("change", (next) => {
      if (
        next !== "active" &&
        (state.current.accepting ||
          ["listening", "stopping"].includes(state.current.stage))
      )
        handlers.current.interrupt(
          "Recording was interrupted. Nothing was saved. Keep the app open while speaking.",
        );
    });
    return () => {
      const current = state.current;
      current.active = false;
      current.generation++;
      stopMic();
      closeSocket();
      subscription.remove();
      if (!["saving", "saved"].includes(current.stage))
        void cancelRemote(current.sessionId);
    };
    // Native stream identity is stable for the fixed capture options.
  }, [jobId]);

  return {
    stage,
    snapshot,
    proposal,
    transcript,
    thinking,
    error,
    warning,
    level,
    start,
    finish,
    cancel,
  };
}
