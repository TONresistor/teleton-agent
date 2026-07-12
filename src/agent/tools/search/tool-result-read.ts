import { Type } from "@sinclair/typebox";
import { readToolResultArtifact } from "../../../memory/tool-result-artifacts.js";
import type { Tool, ToolExecutor } from "../types.js";

interface ToolResultReadParams {
  artifact_id: string;
  offset?: number;
  limit?: number;
}

export const toolResultReadTool: Tool = {
  name: "tool_result_read",
  description:
    "Read the next page of a large tool result using the artifact ID returned by that tool.",
  category: "data-bearing",
  parameters: Type.Object({
    artifact_id: Type.String({ minLength: 36, maxLength: 36 }),
    offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    limit: Type.Optional(Type.Integer({ minimum: 1_000, maximum: 20_000, default: 10_000 })),
  }),
};

export const toolResultReadExecutor: ToolExecutor<ToolResultReadParams> = async (
  { artifact_id, offset = 0, limit = 10_000 },
  context
) => {
  const page = readToolResultArtifact(context.db, artifact_id, context.chatId, offset, limit);
  if (!page) {
    return { success: false, error: "Artifact not found, expired, or belongs to another chat." };
  }
  return {
    success: true,
    data: {
      artifact_id,
      ...page,
      hint: page.nextOffset === null ? "End of artifact." : "Read the next page using nextOffset.",
    },
  };
};
