import { z } from "zod";
import { createLogger } from "../utils/logger.js";

const log = createLogger("Env");

const optionalString = z.string().optional();
const optionalInt = z.coerce.number().int().optional();
const optionalPort = z.coerce.number().int().min(1).max(65535).optional();
const optionalBoolean = z
  .string()
  .optional()
  .transform((v) =>
    v === "true" || v === "1" || v === "yes"
      ? true
      : v === "false" || v === "0" || v === "no"
        ? false
        : undefined
  );

const envSchema = z.object({
  // Core
  TELETON_HOME: optionalString,
  TELETON_API_KEY: optionalString,
  TELETON_BASE_URL: optionalString,
  PI_API_KEY: optionalString,

  // Telegram
  TELETON_TG_API_ID: optionalInt,
  TELETON_TG_API_HASH: optionalString,
  TELETON_TG_PHONE: optionalString,

  // WebUI
  TELETON_WEBUI_ENABLED: optionalBoolean,
  TELETON_WEBUI_PORT: optionalPort,
  TELETON_WEBUI_HOST: optionalString,

  // Management API
  TELETON_API_ENABLED: optionalBoolean,
  TELETON_API_PORT: optionalPort,
  TELETON_JSON_CREDENTIALS: optionalBoolean,

  // Logging
  TELETON_LOG_LEVEL: optionalString,
  TELETON_LOG: optionalString,
  TELETON_LOG_PRETTY: optionalString,

  // External API keys
  TELETON_TAVILY_API_KEY: optionalString,
  TELETON_TONAPI_KEY: optionalString,
  TELETON_TONCENTER_API_KEY: optionalString,
});

export type TeletonEnv = z.infer<typeof envSchema>;

export function validateEnv(): TeletonEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      // Throw on critical env vars that must be valid when set
      if (path === "TELETON_TG_API_ID" && process.env.TELETON_TG_API_ID) {
        throw new Error(
          `Invalid TELETON_TG_API_ID environment variable: "${process.env.TELETON_TG_API_ID}" is not a valid integer`
        );
      }
      log.warn({ path, message: issue.message }, "Invalid env var");
    }
    // Strip invalid fields, re-parse to keep valid ones
    const invalidKeys = new Set(result.error.issues.map((i) => String(i.path[0])));
    const cleaned = { ...process.env };
    for (const key of invalidKeys) delete cleaned[key];
    const retry = envSchema.safeParse(cleaned);
    return retry.success ? retry.data : ({} as TeletonEnv);
  }
  return result.data;
}
