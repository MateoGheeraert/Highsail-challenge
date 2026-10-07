import { Inject } from "@nestjs/common";
import { WebSocketGateway, type OnGatewayConnection } from "@nestjs/websockets";
import type { IncomingMessage } from "node:http";
import WebSocket, { type RawData } from "ws";
import { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { VoiceSessionService } from "./voice-session.service.js";
import type { VoiceSession } from "./session-store.js";

const controlSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("connect"),
      sessionId: z.string().uuid(),
      ticket: z.string().length(64),
    })
    .strict(),
  z
    .object({
      type: z.literal("audio.start"),
      sampleRate: z.number().int().min(8000).max(96000),
      channels: z.literal(1),
      encoding: z.literal("int16"),
    })
    .strict(),
  z
    .object({
      type: z.literal("stop"),
      revision: z.number().int().nonnegative().optional(),
    })
    .strict(),
  z.object({ type: z.literal("cancel") }).strict(),
]);

@WebSocketGateway({
  path: "/api/voice",
  maxPayload: 65_536,
  perMessageDeflate: false,
})
export class VoiceGateway implements OnGatewayConnection {
  constructor(
    private readonly voice: VoiceSessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  handleConnection(socket: WebSocket, request: IncomingMessage) {
    const origin = request.headers.origin;
    if (origin && !this.config.TRUSTED_ORIGINS.includes(origin)) {
      socket.close(1008, "Untrusted origin");
      return;
    }
    let session: VoiceSession | undefined;
    const timeout = setTimeout(
      () => socket.close(1008, "Authentication required"),
      5000,
    );
    const send = (event: Record<string, unknown>) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 512_000) {
        socket.close(1013, "Connection too slow");
        return;
      }
      socket.send(JSON.stringify(event));
    };
    const reject = () => {
      if (session)
        this.voice.fail(
          session,
          "Invalid voice message or interrupted audio. Nothing was saved.",
        );
      else {
        send({
          type: "error",
          message: "Could not authenticate the voice connection. Start again.",
        });
        socket.close(1008);
      }
    };
    socket.on("message", (raw: RawData, binary: boolean) => {
      try {
        const buffer = Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw);
        if (binary) {
          if (!session) {
            reject();
            return;
          }
          this.voice.audio(session, buffer);
          return;
        }
        if (buffer.length > 4096) {
          reject();
          return;
        }
        const command = controlSchema.parse(JSON.parse(buffer.toString()));
        if (command.type === "connect") {
          if (session) {
            reject();
            return;
          }
          session = this.voice.attach(
            command.sessionId,
            command.ticket,
            send,
            () => socket.close(1000),
          );
          clearTimeout(timeout);
          return;
        }
        if (!session) {
          reject();
          return;
        }
        if (command.type === "audio.start")
          void this.voice.start(session, command).catch(reject);
        else if (command.type === "stop")
          void this.voice.stop(session, command.revision).catch(reject);
        else this.voice.cancel(session.ownerId, session.id);
      } catch {
        reject();
      }
    });
    socket.on("close", () => {
      clearTimeout(timeout);
      if (session) this.voice.disconnected(session);
    });
  }
}
