import { Injectable } from "@nestjs/common";
import type { SpeechStream, AudioFormat } from "../ai/deepgram.service.js";
import type { JobSnapshot, Proposal } from "../jobs/proposals.js";
import type { InferenceScheduler } from "./inference-scheduler.js";
import { Transcript } from "./transcript.js";

export type VoiceStatus =
  | "created"
  | "connected"
  | "connecting"
  | "listening"
  | "draining"
  | "ready"
  | "committing"
  | "committed"
  | "canceled"
  | "failed";
export type VoiceSession = {
  id: string;
  ownerId: string;
  ticket: string | null;
  createdAt: number;
  expiresAt: number;
  status: VoiceStatus;
  base: JobSnapshot;
  transcript: Transcript;
  proposal: Proposal;
  proposalRevision: number;
  previews: Map<number, Proposal>;
  abort: AbortController;
  scheduler: InferenceScheduler<string, Proposal>;
  speech?: SpeechStream;
  format?: AudioFormat;
  audioBytes: number;
  lastAudioAt: number;
  listeningAt: number;
  emit?: (event: Record<string, unknown>) => void;
  disconnect?: () => void;
  result?: JobSnapshot;
  committing?: Promise<JobSnapshot>;
};

@Injectable()
export class SessionStore {
  readonly sessions = new Map<string, VoiceSession>();
}
