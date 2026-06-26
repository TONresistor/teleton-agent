import type { ToolScope } from "./types.js";

/**
 * Per-tool access level — the authority ladder from most open to most
 * restrictive. Context-independent: a tool's level applies identically in DMs
 * and in groups. (Who the agent responds to per channel is a separate, global
 * concern — telegram.dm_policy / telegram.group_policy.)
 * - "all":       anyone the agent talks to
 * - "allowlist": only `telegram.allow_from` user IDs (admins always pass)
 * - "admin":     only `telegram.admin_ids`
 * - "off":       nobody — the tool is disabled
 */
export type ToolAccessLevel = "all" | "allowlist" | "admin" | "off";

export function isToolAccessLevel(v: unknown): v is ToolAccessLevel {
  return v === "all" || v === "allowlist" || v === "admin" || v === "off";
}

/**
 * Map a single-value {@link ToolScope} (the code-declared default for built-in /
 * MCP / plugin tools) to an access level. Single source of truth for the
 * scope→level translation — reused by the DB migration, the runtime default
 * seeding, and the API. Note the channel dimension (dm-only / group-only) maps
 * to level "all" here because it is NOT an authority level: it is enforced
 * separately in ToolRegistry.checkAccess from the tool's declared scope.
 */
export function scopeToLevel(scope: ToolScope | null | undefined): ToolAccessLevel {
  switch (scope) {
    case "admin-only":
      return "admin";
    case "allowlist":
      return "allowlist";
    case "disabled":
      return "off";
    // "open" | "always" | "dm-only" | "group-only" | null | undefined
    default:
      return "all";
  }
}

/**
 * Collapse an access level back to the closest legacy {@link ToolScope}. Used
 * only for backward compatibility (legacy API field, ToolEntry.scope, the
 * retained `scope` DB column for downgrade safety).
 */
export function levelToScope(level: ToolAccessLevel): ToolScope {
  switch (level) {
    case "admin":
      return "admin-only";
    case "allowlist":
      return "allowlist";
    case "off":
      return "disabled";
    case "all":
    default:
      return "open";
  }
}
