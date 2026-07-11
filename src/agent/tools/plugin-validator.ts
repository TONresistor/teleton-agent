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
import {
  PLUGIN_HOOK_NAMES,
  TOOL_CATEGORIES,
  TOOL_SCOPES,
  type PluginManifest,
  type SimpleToolDef,
} from "@teleton-agent/sdk";

const log = createLogger("PluginValidator");
const SECRET_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;

const ManifestSchema: z.ZodType<PluginManifest> = z
  .object({
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
        z.string().regex(SECRET_KEY_RE, "Must be a valid secret key identifier"),
        z.object({
          required: z.boolean(),
          description: z.string().max(256),
          env: z
            .string()
            .max(128)
            .regex(/^[A-Z_][A-Z0-9_]*$/, "Must be an uppercase environment variable name")
            .optional(),
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
          name: z.enum(PLUGIN_HOOK_NAMES),
          priority: z.number().min(-1000).max(1000).optional(),
          description: z.string().max(256).optional(),
        })
      )
      .optional(),
  })
  .superRefine((manifest, ctx) => {
    const envPrefix = `TELETON_PLUGIN_${manifest.name.replace(/-/g, "_").toUpperCase()}_`;
    for (const [key, declaration] of Object.entries(manifest.secrets ?? {})) {
      if (declaration.env && !declaration.env.startsWith(envPrefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["secrets", key, "env"],
          message: `Must start with the plugin namespace ${envPrefix}`,
        });
      }
    }
  });

export type { PluginManifest, SimpleToolDef } from "@teleton-agent/sdk";

export function validateManifest(raw: unknown): PluginManifest {
  if (raw && typeof raw === "object") {
    const secrets = (raw as { secrets?: unknown }).secrets;
    if (secrets && typeof secrets === "object" && !Array.isArray(secrets)) {
      for (const key of Object.keys(secrets)) {
        if (!SECRET_KEY_RE.test(key)) throw new Error(`Invalid plugin secret key: ${key}`);
      }
    }
  }
  return ManifestSchema.parse(raw);
}

export function validateToolDefs(defs: unknown[], pluginName: string): SimpleToolDef[] {
  const valid: SimpleToolDef[] = [];
  const names = new Set<string>();

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

    if (!/^[a-z][a-z0-9_]{0,63}$/.test(t.name)) {
      log.warn(`[${pluginName}] tool "${t.name}" has an invalid name, skipping`);
      continue;
    }

    if (names.has(t.name)) {
      log.warn(`[${pluginName}] tool "${t.name}" is declared more than once, skipping`);
      continue;
    }

    if (!t.description || typeof t.description !== "string" || t.description.length > 1024) {
      log.warn(`[${pluginName}] tool "${t.name}" missing 'description', skipping`);
      continue;
    }

    if (!t.execute || typeof t.execute !== "function") {
      log.warn(`[${pluginName}] tool "${t.name}" missing 'execute' function, skipping`);
      continue;
    }

    if (
      t.parameters !== undefined &&
      (!t.parameters || typeof t.parameters !== "object" || Array.isArray(t.parameters))
    ) {
      log.warn(`[${pluginName}] tool "${t.name}" has invalid parameters, skipping`);
      continue;
    }

    if (t.scope !== undefined && !TOOL_SCOPES.includes(t.scope as never)) {
      log.warn(`[${pluginName}] tool "${t.name}" has invalid scope, skipping`);
      continue;
    }

    if (t.category !== undefined && !TOOL_CATEGORIES.includes(t.category as never)) {
      log.warn(`[${pluginName}] tool "${t.name}" has invalid category, skipping`);
      continue;
    }

    if (t.requiresApproval !== undefined && typeof t.requiresApproval !== "boolean") {
      log.warn(`[${pluginName}] tool "${t.name}" has invalid approval policy, skipping`);
      continue;
    }

    names.add(t.name);
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
