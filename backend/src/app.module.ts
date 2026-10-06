import { Module } from "@nestjs/common";
import { MeController } from "./auth/me.controller.js";
import { HealthController } from "./health.controller.js";
import { InfrastructureModule } from "./infrastructure.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { VoiceModule } from "./voice/voice.module.js";

@Module({
  imports: [InfrastructureModule, JobsModule, VoiceModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
