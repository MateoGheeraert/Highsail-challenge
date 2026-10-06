import {
  BadRequestException,
  Body,
  Controller,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  SessionGuard,
  type AuthenticatedRequest,
} from "../auth/session.guard.js";
import { VoiceSessionService } from "./voice-session.service.js";

@Controller()
@UseGuards(SessionGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceSessionService) {}

  @Post("jobs/:jobId/voice-sessions")
  create(@Req() request: AuthenticatedRequest, @Param("jobId") jobId: string) {
    return this.voice.create(request.authSession.user.id, jobId);
  }

  @Post("voice-sessions/:id/finish")
  finish(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const parsed = z
      .object({ revision: z.number().int().nonnegative() })
      .strict()
      .safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        "A valid final proposal revision is required.",
      );
    return this.voice.finish(
      request.authSession.user.id,
      id,
      parsed.data.revision,
    );
  }

  @Post("voice-sessions/:id/cancel")
  cancel(@Req() request: AuthenticatedRequest, @Param("id") id: string) {
    this.voice.cancel(request.authSession.user.id, id);
    return { canceled: true };
  }
}
