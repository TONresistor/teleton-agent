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

import type { Tool } from "@earendil-works/pi-ai";

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

export function sanitizeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const result: Record<string, unknown> = { ...schema };

  for (const key of UNSUPPORTED_KEYS) {
    delete result[key];
  }

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

  if (Array.isArray(result.anyOf)) {
    delete result.anyOf;
    if (!result.type) result.type = "string";
  }

  if (result.const !== undefined) {
    result.enum = [result.const];
    if (!result.type) {
      const jsType = typeof result.const;
      result.type = jsType === "string" ? "string" : jsType === "boolean" ? "boolean" : "number";
    }
    delete result.const;
  }

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

  if (result.items && typeof result.items === "object" && !Array.isArray(result.items)) {
    result.items = sanitizeSchema(result.items as Record<string, unknown>);
  }

  return result;
}

export function sanitizeToolsForGemini(tools: Tool[]): Tool[] {
  return tools.map(
    (tool) =>
      ({
        ...tool,
        parameters: sanitizeSchema({ ...tool.parameters }),
      }) as Tool
  );
}
