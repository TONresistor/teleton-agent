/**
 * Plugin validation utilities.
 *
 * - Manifest validation via Zod
 * - Tool definition validation
 * - Config sanitization (strip sensitive fields before exposing to plugins)
 */

import { z } from "zod";
import type { Config } from "../../config/schema.js";

// ─── Manifest Schema ──────────────────────────────────────────────

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
});

export type PluginManifest = z.infer<typeof ManifestSchema>;

/**
 * Validate a raw manifest object. Throws ZodError on failure.
 */
export function validateManifest(raw: unknown): PluginManifest {
  return ManifestSchema.parse(raw);
}

// ─── Tool Definition Validation ───────────────────────────────────

export interface SimpleToolDef {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  execute: (
    params: any,
    context: any
  ) => Promise<{ success: boolean; data?: unknown; error?: string }>;
  scope?: "always" | "dm-only" | "group-only";
  category?: "data-bearing" | "action";
}

/**
 * Validate and filter tool definitions. Returns only valid tools.
 */
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

// ─── Config Sanitization ──────────────────────────────────────────

/**
 * Strip sensitive fields from config before exposing to external plugins.
 * Plugins should not see API keys, phone numbers, or session paths.
 * Plugins receive their own config via sdk.pluginConfig, not sdk.config.plugins.
 */
export function sanitizeConfigForPlugins(config: Config): Record<string, unknown> {
  return {
    agent: {
      provider: config.agent.provider,
      model: config.agent.model,
      max_tokens: config.agent.max_tokens,
    },
    deals: { enabled: config.deals.enabled },
    market: { enabled: config.market.enabled },
  };
}
