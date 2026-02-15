/**
 * Plugin validation utilities.
 *
 * - Manifest validation via Zod
 * - Tool definition validation
 * - Config sanitization (strip sensitive fields before exposing to plugins)
 */

import { z } from "zod";
import type { Config } from "../../config/schema.js";

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
  execute: (
    params: any,
    context: any
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  scope?: "always" | "dm-only" | "group-only" | "admin-only";
  category?: "data-bearing" | "action";
}

export function validateToolDefs(defs: unknown[], pluginName: string): SimpleToolDef[] {
  const valid: SimpleToolDef[] = [];

  for (const def of defs) {
    if (!def || typeof def !== "object") {
      console.warn(`⚠️  [${pluginName}] tool is not an object, skipping`);
      continue;
    }

    const t = def as Record<string, unknown>;

    if (!t.name || typeof t.name !== "string") {
      console.warn(`⚠️  [${pluginName}] tool missing 'name', skipping`);
      continue;
    }

    if (!t.description || typeof t.description !== "string") {
      console.warn(`⚠️  [${pluginName}] tool "${t.name}" missing 'description', skipping`);
      continue;
    }

    if (!t.execute || typeof t.execute !== "function") {
      console.warn(`⚠️  [${pluginName}] tool "${t.name}" missing 'execute' function, skipping`);
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
    deals: { enabled: config.deals.enabled },
  };
}
