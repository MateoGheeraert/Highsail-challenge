import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { APP_CONFIG, type AppConfig } from "../config.js";

@Injectable()
export class OpenAiService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async structured<T extends z.ZodType>(
    schema: T,
    instructions: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<z.infer<T>> {
    if (!this.config.OPENAI_API_KEY)
      throw new ServiceUnavailableException(
        "Configure OPENAI_API_KEY on the backend to enable voice.",
      );
    const client = new OpenAI({
      apiKey: this.config.OPENAI_API_KEY,
      maxRetries: 0,
      timeout: 25_000,
    });
    const stream = client.responses.stream(
      {
        model: this.config.OPENAI_MODEL,
        instructions,
        input: JSON.stringify(input),
        reasoning: { effort: "minimal" },
        text: { format: zodTextFormat(schema, "job_proposals") },
        max_output_tokens: 6000,
        store: false,
      },
      { signal: AbortSignal.any([signal, AbortSignal.timeout(25_000)]) },
    );
    const response = await stream.finalResponse();
    if (response.status !== "completed" || response.output_parsed == null) {
      throw new Error("The interpretation was incomplete. Please retry.");
    }
    return schema.parse(response.output_parsed);
  }
}
