import type { JsonObject } from "@earendil-works/pi-ai";
import { z } from "zod";

const toolArgumentsSchema = z.record(z.string(), z.json());

/** Validate plugin and scheduled-task inputs before passing them to pi-ai. */
export function parseToolArguments(value: unknown): JsonObject {
  return toolArgumentsSchema.parse(value);
}
