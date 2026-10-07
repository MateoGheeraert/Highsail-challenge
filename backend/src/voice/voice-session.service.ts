import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  type OnModuleDestroy,
} from "@nestjs/common";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { DeepgramService, type AudioFormat } from "../ai/deepgram.service.js";
import { JobsService } from "../jobs/jobs.service.js";
import {
  emptyProposal,
  previewProposal,
  savableProposal,
} from "../jobs/proposals.js";
import { ProposalInterpreter } from "./proposal-interpreter.js";
import { InferenceScheduler } from "./inference-scheduler.js";
import { SessionStore, type VoiceSession } from "./session-store.js";
import { Transcript } from "./transcript.js";

@Injectable()
export class VoiceSessionService implements OnModuleDestroy {
  private readonly cleanupTimer = setInterval(
    () => this.cleanup(),
    15_000,
  ).unref();

  constructor(
    private readonly store: SessionStore,
    private readonly jobs: JobsService,
    private readonly deepgram: DeepgramService,
    private readonly interpreter: ProposalInterpreter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(ownerId: string, jobId: string) {
    if (!this.config.OPENAI_API_KEY || !this.config.DEEPGRAM_API_KEY) {
      throw new ServiceUnavailableException(
        "Voice requires OPENAI_API_KEY and DEEPGRAM_API_KEY in the backend environment.",
      );
    }
    const base = await this.jobs.get(ownerId, jobId);
    if (
      [...this.store.sessions.values()].some(
        (s) =>
          s.ownerId === ownerId &&
          !["committed", "canceled", "failed"].includes(s.status),
      )
    ) {
      throw new ConflictException(
        "A speaking session is already open. Cancel it or wait for it to expire.",
      );
    }
    const id = randomUUID();
    const ticket = randomBytes(32).toString("hex");
    const session: VoiceSession = {
      id,
      ownerId,
      ticket,
      base,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      status: "created",
      transcript: new Transcript(),
      proposal: emptyProposal(),
      proposalRevision: 0,
      previews: new Map([[0, emptyProposal()]]),
      abort: new AbortController(),
      audioBytes: 0,
      lastAudioAt: 0,
      listeningAt: 0,
      scheduler: new InferenceScheduler(
        async (transcript) => {
          this.emit(session, { type: "thinking", active: true });
          return this.interpreter.interpret(
            session.base,
            session.proposal,
            transcript,
            session.abort.signal,
          );
        },
        (proposal, revision) => {
          proposal = savableProposal(proposal, session.base);
          session.proposal = proposal;
          session.proposalRevision = revision;
          session.previews.set(revision, structuredClone(proposal));
          if (session.previews.size > 32)
            session.previews.delete(session.previews.keys().next().value!);
          this.emit(session, {
            type: "proposals",
            proposal,
            revision,
            preview: previewProposal(session.base, proposal),
          });
          this.emit(session, { type: "thinking", active: false });
        },
        () => {
          this.emit(session, { type: "thinking", active: false });
          // Keep the last valid visible preview; a failed suggestion is skipped.
        },
      ),
    };
    this.store.sessions.set(id, session);
    return { sessionId: id, ticket, expiresIn: 60, snapshot: base };
  }

  attach(
    id: string,
    ticket: string,
    emit: VoiceSession["emit"],
    disconnect: () => void,
  ) {
    const session = this.store.sessions.get(id);
    const expected = Buffer.from(session?.ticket || "");
    const provided = Buffer.from(ticket);
    if (
      !session ||
      session.status !== "created" ||
      session.expiresAt <= Date.now() ||
      expected.length !== provided.length ||
      !timingSafeEqual(expected, provided)
    ) {
      throw new UnauthorizedException(
        "Invalid or expired voice connection. Start again.",
      );
    }
    session.ticket = null;
    session.emit = emit;
    session.disconnect = disconnect;
    session.status = "connected";
    session.expiresAt = Date.now() + 10 * 60_000;
    this.emit(session, { type: "connected", snapshot: session.base });
    return session;
  }

  async start(session: VoiceSession, format: AudioFormat) {
    if (session.status !== "connected")
      throw new BadRequestException("Audio has already started.");
    session.status = "connecting";
    session.format = format;
    try {
      const speech = await this.deepgram.connect(
        format,
        (result) => {
          if (!["listening", "draining"].includes(session.status)) return;
          const changed = session.transcript.update(result);
          if (session.transcript.text.length > 24_000) {
            this.fail(
              session,
              "This session is too long. Start a shorter recording.",
            );
            return;
          }
          if (changed || result.isFinal) {
            this.emit(session, {
              type: "transcript",
              final: session.transcript.finalText,
              interim: session.transcript.interimText,
              revision: session.transcript.revision,
            });
          }
          if (changed)
            session.scheduler.request(
              session.transcript.revision,
              session.transcript.text,
            );
        },
        (error) => this.fail(session, error.message),
        session.abort.signal,
      );
      if (session.status !== "connecting") {
        speech.close();
        return;
      }
      session.speech = speech;
      session.status = "listening";
      session.lastAudioAt = Date.now();
      session.listeningAt = Date.now();
      this.emit(session, { type: "listening" });
    } catch {
      this.fail(
        session,
        "Could not start speech recognition. Check the backend Deepgram key, quota and network.",
      );
    }
  }

  audio(session: VoiceSession, data: Buffer) {
    if (session.status !== "listening" || !session.speech || !session.format)
      throw new BadRequestException("Audio is not ready.");
    if (!data.length || data.length % (2 * session.format.channels) !== 0)
      throw new BadRequestException("Invalid PCM frame.");
    const budget = (Date.now() - session.listeningAt) / 1000 + 10;
    session.audioBytes += data.length;
    if (
      session.audioBytes >
      budget * session.format.sampleRate * session.format.channels * 2
    )
      throw new BadRequestException("Audio was sent too quickly.");
    session.lastAudioAt = Date.now();
    session.speech.send(data);
  }

  async stop(session: VoiceSession, visibleRevision?: number) {
    if (session.status === "ready") {
      this.emitReady(session);
      return;
    }
    if (session.status === "draining") return;
    if (session.status !== "listening")
      throw new BadRequestException("Speech has not started.");
    if (visibleRevision !== undefined) {
      const visible = session.previews.get(visibleRevision);
      if (!visible)
        throw new ConflictException(
          "This preview expired. Restart speaking before saving.",
        );
      session.proposal = structuredClone(visible);
      session.proposalRevision = visibleRevision;
      session.status = "ready";
      session.expiresAt = Date.now() + 5 * 60_000;
      // Freeze before closing providers so late results cannot alter acceptance.
      this.release(session);
      this.emit(session, { type: "thinking", active: false });
      this.emitReady(session);
      return;
    }
    session.status = "draining";
    this.emit(session, { type: "draining" });
    try {
      await session.speech!.finish();
      if (session.status !== "draining") return;
      if (session.transcript.interimText)
        throw new Error(
          "Speech recognition did not finalize the last words. Please restart.",
        );
      await session.scheduler.flush();
      if (session.status !== "draining") return;
      if (!session.transcript.finalText)
        session.proposal.issues = [
          "No speech was detected. Cancel and try again closer to the microphone.",
        ];
      session.status = "ready";
      session.expiresAt = Date.now() + 5 * 60_000;
      this.emitReady(session);
    } catch {
      this.fail(
        session,
        "Could not finish processing all speech. Nothing was saved. Cancel and try again.",
      );
    }
  }

  async finish(ownerId: string, id: string, revision: number) {
    const session = this.owned(ownerId, id);
    if (session.status === "committed") return session.result!;
    if (session.status === "committing") return session.committing!;
    if (session.status !== "ready" || revision !== session.proposalRevision)
      throw new ConflictException("Wait for the final proposal before saving.");
    if (session.proposal.issues.length)
      throw new BadRequestException(session.proposal.issues.join(" "));
    session.status = "committing";
    session.committing = this.jobs.commitProposal(
      ownerId,
      session.base.id,
      session.base.version,
      session.proposal,
    );
    try {
      session.result = await session.committing;
      session.status = "committed";
      session.expiresAt = Date.now() + 5 * 60_000;
      this.release(session);
      this.emit(session, { type: "committed", job: session.result });
      return session.result;
    } catch (error) {
      session.status = "ready";
      session.committing = undefined;
      throw error;
    }
  }

  cancel(ownerId: string, id: string) {
    const session = this.owned(ownerId, id);
    if (session.status === "committing" || session.status === "committed")
      throw new ConflictException(
        "Saving has already started. Reload the job to see its saved values.",
      );
    session.status = "canceled";
    session.expiresAt = Date.now() + 60_000;
    this.release(session);
    this.emit(session, { type: "canceled" });
    session.disconnect?.();
  }

  disconnected(session: VoiceSession) {
    session.emit = undefined;
    session.disconnect = undefined;
    if (
      !["ready", "committing", "committed", "canceled", "failed"].includes(
        session.status,
      )
    )
      this.fail(session, "Connection lost. Nothing was saved.");
  }

  fail(session: VoiceSession, message: string) {
    if (
      ["committing", "committed", "canceled", "failed"].includes(session.status)
    )
      return;
    session.status = "failed";
    session.expiresAt = Date.now() + 60_000;
    this.release(session);
    this.emit(session, { type: "error", message });
    session.disconnect?.();
  }

  private owned(ownerId: string, id: string) {
    const session = this.store.sessions.get(id);
    if (
      !session ||
      session.ownerId !== ownerId ||
      session.expiresAt <= Date.now()
    )
      throw new NotFoundException("Voice session expired. Start again.");
    return session;
  }
  private emit(session: VoiceSession, event: Record<string, unknown>) {
    session.emit?.({ ...event, sessionId: session.id });
  }
  private emitReady(session: VoiceSession) {
    this.emit(session, {
      type: "ready",
      revision: session.proposalRevision,
      proposal: session.proposal,
    });
  }
  private release(session: VoiceSession) {
    session.scheduler.close();
    session.abort.abort();
    session.speech?.close();
  }
  private cleanup() {
    for (const session of this.store.sessions.values()) {
      if (session.status === "committing") continue;
      if (session.expiresAt <= Date.now()) {
        this.fail(session, "Voice session expired. Nothing was saved.");
        this.release(session);
        session.disconnect?.();
        this.store.sessions.delete(session.id);
      } else if (
        session.status === "listening" &&
        Date.now() - session.lastAudioAt > 15_000
      )
        this.fail(
          session,
          "Microphone audio stopped. Please restart speaking.",
        );
      else if (
        session.status === "connected" &&
        Date.now() - session.createdAt > 60_000
      )
        this.fail(session, "The microphone did not start. Please try again.");
    }
  }
  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
    for (const session of this.store.sessions.values()) {
      this.release(session);
      session.disconnect?.();
    }
    this.store.sessions.clear();
  }
}
