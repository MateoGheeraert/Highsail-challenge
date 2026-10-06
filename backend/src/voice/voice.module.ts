import { Module } from "@nestjs/common";
import { AiModule } from "../ai/ai.module.js";
import { InfrastructureModule } from "../infrastructure.module.js";
import { JobsModule } from "../jobs/jobs.module.js";
import { VoiceController } from "./voice.controller.js";
import { VoiceGateway } from "./voice.gateway.js";
import { VoiceSessionService } from "./voice-session.service.js";
import { SessionStore } from "./session-store.js";
import { ProposalInterpreter } from "./proposal-interpreter.js";

@Module({
  imports: [InfrastructureModule, AiModule, JobsModule],
  controllers: [VoiceController],
  providers: [
    VoiceGateway,
    VoiceSessionService,
    SessionStore,
    ProposalInterpreter,
  ],
})
export class VoiceModule {}
