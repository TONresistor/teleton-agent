/**
 * Schema sanitizer for Gemini compatibility.
 *
 * Google Gemini's function_declarations API uses a strict subset of OpenAPI 3.0.
 * It rejects several standard JSON Schema keywords that TypeBox generates:
 *   - anyOf / oneOf / allOf  (use enum instead)
 *   - const                  (use single-value enum instead)
 *   - $schema, $id, $ref, $defs, $anchor, title, default, examples
 *
 * This module converts TypeBox-generated schemas into Gemini-compatible format
 * without mutating the originals.
 */

import type { Tool } from "@mariozechner/pi-ai";

/** JSON Schema keywords that Gemini function declarations do not support. */
const UNSUPPORTED_KEYS: ReadonlySet<string> = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "$anchor",
  "title",
  "default",
  "examples",
]);

/**
 * Recursively sanitize a JSON Schema object for Gemini compatibility.
 *
 * Main transformations:
 *  1. Strip unsupported keywords ($schema, $id, title, default, etc.)
 *  2. Convert `anyOf[{const:"a"},{const:"b"}]` → `{type:"string", enum:["a","b"]}`
 *  3. Convert standalone `const` → single-value `enum`
 *  4. Recurse into `properties` and `items`
 */
export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result: Record<string, unknown> = { ...schema };

  // 1. Strip unsupported keywords
  for (const key of UNSUPPORTED_KEYS) {
    delete result[key];
  }

  // 2. Convert anyOf + const → enum
  if (Array.isArray(result.anyOf)) {
    const items = result.anyOf as Record<string, unknown>[];
    const nonNull = items.filter((s) => s.type !== "null");
    const allConst = nonNull.length > 0 && nonNull.every((s) => s.const !== undefined);

    if (allConst) {
      const enumValues = nonNull.map((s) => s.const);
      const inferredType = (nonNull[0]?.type as string) || "string";
      delete result.anyOf;
      result.type = inferredType;
      result.enum = enumValues;
    } else if (nonNull.length > 0) {
      // Non-const anyOf: fall back to the first non-null branch type
      delete result.anyOf;
      const first = nonNull[0];
      if (first.type) result.type = first.type;
      if (first.enum) result.enum = first.enum;
      if (first.description && !result.description) {
        result.description = first.description;
      }
    }
  }

  // 3. Clean up degenerate anyOf (empty or all-null) that wasn't handled above
  if (Array.isArray(result.anyOf)) {
    delete result.anyOf;
    if (!result.type) result.type = "string";
  }

  // 4. Convert standalone const → single-value enum
  if (result.const !== undefined) {
    result.enum = [result.const];
    if (!result.type) {
      const jsType = typeof result.const;
      result.type = jsType === "string" ? "string" : jsType === "boolean" ? "boolean" : "number";
    }
    delete result.const;
  }

  // 5. Recurse into object properties
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      sanitized[key] =
        value && typeof value === "object" && !Array.isArray(value)
          ? sanitizeSchema(value as Record<string, unknown>)
          : value;
    }
    result.properties = sanitized;
  }

  // 6. Recurse into array items
  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = sanitizeSchema(result.items as Record<string, unknown>);
  }

  return result;
}

/**
 * Return a new tools array with Gemini-compatible parameter schemas.
 * The original tool objects are never mutated.
 *
 * The `as Tool` cast is necessary because sanitizeSchema returns a plain
 * Record<string, unknown> (the TypeBox TSchema brand is lost after
 * destructuring), but the runtime shape is identical.
 */
export function sanitizeToolsForGemini(tools: Tool[]): Tool[] {
  return tools.map(
    (tool) =>
      ({
        ...tool,
        parameters: sanitizeSchema({ ...tool.parameters }),
      }) as Tool
  );
}
