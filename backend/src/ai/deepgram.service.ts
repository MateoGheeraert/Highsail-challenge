import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import WebSocket from "ws";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config.js";

export type SpeechResult = {
  start: number;
  duration: number;
  text: string;
  isFinal: boolean;
};
export type AudioFormat = {
  sampleRate: number;
  channels: number;
  encoding: "int16";
};
export interface SpeechStream {
  send(audio: Buffer): void;
  finish(): Promise<void>;
  close(): void;
}
const resultSchema = z.object({
  type: z.literal("Results"),
  start: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  is_final: z.boolean(),
  channel: z.object({
    alternatives: z.array(z.object({ transcript: z.string() })).min(1),
  }),
});

@Injectable()
export class DeepgramService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async connect(
    format: AudioFormat,
    onResult: (result: SpeechResult) => void,
    onError: (error: Error) => void,
    signal: AbortSignal,
  ): Promise<SpeechStream> {
    if (!this.config.DEEPGRAM_API_KEY)
      throw new ServiceUnavailableException(
        "Configure DEEPGRAM_API_KEY on the backend to enable voice.",
      );
    signal.throwIfAborted();
    const params = new URLSearchParams({
      model: this.config.DEEPGRAM_MODEL,
      language: "en",
      encoding: "linear16",
      sample_rate: String(format.sampleRate),
      channels: String(format.channels),
      interim_results: "true",
      smart_format: "true",
      punctuate: "true",
      endpointing: "300",
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
      headers: { Authorization: `Token ${this.config.DEEPGRAM_API_KEY}` },
      handshakeTimeout: 10_000,
    });
    let stopped = false;
    let draining = false;
    let metadata = false;
    let failure: Error | undefined;
    let keepAlive: ReturnType<typeof setInterval> | undefined;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    let resolveDrain: (() => void) | undefined;
    let rejectDrain: ((error: Error) => void) | undefined;
    let drainPromise: Promise<void> | undefined;
    const cleanup = () => {
      clearInterval(keepAlive);
      clearTimeout(drainTimer);
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error) => {
      if (stopped || failure) return;
      failure = error;
      cleanup();
      rejectDrain?.(error);
      onError(error);
      ws.terminate();
    };
    const abort = () => {
      stopped = true;
      cleanup();
      rejectDrain?.(new Error("Voice session canceled."));
      ws.terminate();
    };
    signal.addEventListener("abort", abort, { once: true });
    ws.on("error", () =>
      fail(
        new Error(
          "Speech recognition connection failed. Check the Deepgram key and network.",
        ),
      ),
    );
    ws.on("message", (raw) => {
      if (stopped || failure) return;
      try {
        const message = JSON.parse(raw.toString());
        if (message.type === "Metadata" && draining) {
          metadata = true;
          return;
        }
        if (message.type === "Error") {
          fail(
            new Error("Speech recognition failed. Please restart speaking."),
          );
          return;
        }
        if (message.type !== "Results") return;
        const result = resultSchema.parse(message);
        onResult({
          start: result.start,
          duration: result.duration,
          text: result.channel.alternatives[0]!.transcript,
          isFinal: result.is_final,
        });
      } catch {
        fail(new Error("Speech recognition returned an invalid response."));
      }
    });
    ws.on("close", (code) => {
      cleanup();
      if (stopped || failure) return;
      if (draining && metadata && code === 1000) resolveDrain?.();
      else
        fail(
          new Error(
            "Speech recognition disconnected before all audio was processed.",
          ),
        );
    });
    await new Promise<void>((resolve, reject) => {
      const aborted = () => {
        clean();
        reject(new Error("Voice session canceled."));
      };
      const failed = () => {
        clean();
        reject(
          new Error(
            "Could not connect to Deepgram. Check the API key and quota.",
          ),
        );
      };
      const clean = () => {
        signal.removeEventListener("abort", aborted);
        ws.off("error", failed);
        ws.off("close", failed);
      };
      ws.once("open", () => {
        clean();
        resolve();
      });
      ws.once("error", failed);
      ws.once("close", failed);
      signal.addEventListener("abort", aborted, { once: true });
    });
    signal.throwIfAborted();
    keepAlive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN && !draining)
        ws.send(JSON.stringify({ type: "KeepAlive" }));
    }, 4000);
    return {
      send(audio) {
        if (stopped || failure || draining || ws.readyState !== WebSocket.OPEN)
          throw new Error("Speech connection is not ready.");
        if (ws.bufferedAmount > 512_000)
          throw new Error("Speech connection is too slow. Please restart.");
        ws.send(audio);
      },
      finish() {
        if (drainPromise) return drainPromise;
        if (failure || stopped || ws.readyState !== WebSocket.OPEN)
          return Promise.reject(
            failure || new Error("Speech connection closed."),
          );
        draining = true;
        clearInterval(keepAlive);
        // CloseStream drains audio AND closes the stream, including the silent-mic
        // case where a standalone Finalize need not emit a from_finalize result.
        drainPromise = new Promise<void>((resolve, reject) => {
          resolveDrain = resolve;
          rejectDrain = reject;
          drainTimer = setTimeout(
            () =>
              fail(
                new Error(
                  "Timed out finishing speech recognition. Nothing was saved.",
                ),
              ),
            12_000,
          );
          ws.send(JSON.stringify({ type: "CloseStream" }));
        });
        return drainPromise;
      },
      close: abort,
    };
  }
}
