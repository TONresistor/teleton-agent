/**
 * Plugin validation utilities.
 *
 * - Manifest validation via Zod
 * - Tool definition validation
 * - Config sanitization (strip sensitive fields before exposing to plugins)
 */

import { z } from "zod";
import type { Config } from "../../config/schema.js";
import { createLogger } from "../../utils/logger.js";

const log = createLogger("PluginValidator");

const ManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      "Must be lowercase alphanumeric with hyphens, starting with a letter or number"
    ),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Must be semver (e.g., 1.0.0)"),
  author: z.string().max(128).optional(),
  description: z.string().max(256).optional(),
  dependencies: z.array(z.string()).optional(),
  defaultConfig: z.record(z.string(), z.unknown()).optional(),
  sdkVersion: z.string().max(32).optional(),
  secrets: z
    .record(
      z.string(),
      z.object({
        required: z.boolean(),
        description: z.string().max(256),
        env: z.string().max(128).optional(),
      })
    )
    .optional(),
  bot: z
    .object({
      inline: z.boolean().optional(),
      callbacks: z.boolean().optional(),
      rateLimits: z
        .object({
          inlinePerMinute: z.number().positive().optional(),
          callbackPerMinute: z.number().positive().optional(),
        })
        .optional(),
    })
    .optional(),
  hooks: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        priority: z.number().optional(),
        description: z.string().max(256).optional(),
      })
    )
    .optional(),
});

export type PluginManifest = z.infer<typeof ManifestSchema>;

export function validateManifest(raw: unknown): PluginManifest {
  return ManifestSchema.parse(raw);
}

export interface SimpleToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  /* eslint-disable @typescript-eslint/no-explicit-any -- plugin tool params/context are untyped */
  execute: (
    params: any,
    context: any
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  scope?: "always" | "dm-only" | "group-only" | "admin-only" | "open" | "allowlist" | "disabled";
  category?: "data-bearing" | "action";
}

export function validateToolDefs(defs: unknown[], pluginName: string): SimpleToolDef[] {
  const valid: SimpleToolDef[] = [];

  for (const def of defs) {
    if (!def || typeof def !== "object") {
      log.warn(`[${pluginName}] tool is not an object, skipping`);
      continue;
    }

    const t = def as Record<string, unknown>;

    if (!t.name || typeof t.name !== "string") {
      log.warn(`[${pluginName}] tool missing 'name', skipping`);
      continue;
    }

    if (!t.description || typeof t.description !== "string") {
      log.warn(`[${pluginName}] tool "${t.name}" missing 'description', skipping`);
      continue;
    }

    if (!t.execute || typeof t.execute !== "function") {
      log.warn(`[${pluginName}] tool "${t.name}" missing 'execute' function, skipping`);
      continue;
    }

    valid.push(t as unknown as SimpleToolDef);
  }

  return valid;
}

export function sanitizeConfigForPlugins(config: Config): Record<string, unknown> {
  return {
    agent: {
      provider: config.agent.provider,
      model: config.agent.model,
      max_tokens: config.agent.max_tokens,
    },
    telegram: {
      admin_ids: config.telegram.admin_ids,
    },
  };
}
