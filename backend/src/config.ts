import "dotenv/config";
import { z } from "zod";

const environment = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  OPENAI_API_KEY: z.string().optional(),
  DEEPGRAM_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.literal("gpt-5-mini").default("gpt-5-mini"),
  DEEPGRAM_MODEL: z.literal("nova-3").default("nova-3"),
  DATABASE_URL: z
    .url()
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      "Must be a PostgreSQL connection URL",
    ),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32)
    .refine(
      (value) => !value.startsWith("replace-with-"),
      "Generate a random auth secret",
    ),
  TRUSTED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export function readConfig() {
  const result = environment.safeParse(process.env);
  if (!result.success) {
    // Report keys and validation messages, never environment values.
    throw new Error(
      `Invalid environment: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (
    result.data.NODE_ENV === "production" &&
    !result.data.BETTER_AUTH_URL.startsWith("https://")
  ) {
    throw new Error("BETTER_AUTH_URL must use HTTPS in production");
  }
  return result.data;
}

export type AppConfig = ReturnType<typeof readConfig>;
export const APP_CONFIG = Symbol("APP_CONFIG");
