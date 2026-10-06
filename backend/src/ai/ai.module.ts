import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure.module.js";
import { DeepgramService } from "./deepgram.service.js";
import { OpenAiService } from "./openai.service.js";

@Module({
  imports: [InfrastructureModule],
  providers: [DeepgramService, OpenAiService],
  exports: [DeepgramService, OpenAiService],
})
export class AiModule {}
