// src/agent/tools/web/search.ts

import { Type } from "@sinclair/typebox";
import { tavily } from "@tavily/core";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { WEB_SEARCH_MAX_RESULTS } from "../../../constants/limits.js";
import { sanitizeForContext } from "../../../utils/sanitize.js";
import { getErrorMessage } from "../../../utils/errors.js";

interface WebSearchParams {
  query: string;
  count?: number;
  topic?: "general" | "news" | "finance";
}

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web. Returns results with title, URL, and content snippet.",
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.String({ description: "Search query" }),
    count: Type.Optional(
      Type.Number({
        description: `Number of results (default 5, max ${WEB_SEARCH_MAX_RESULTS})`,
      })
    ),
    topic: Type.Optional(
      Type.Union([Type.Literal("general"), Type.Literal("news"), Type.Literal("finance")], {
        description: "Search topic: general, news, or finance",
      })
    ),
  }),
};

export const webSearchExecutor: ToolExecutor<WebSearchParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const apiKey = context.config?.tavily_api_key;
    if (!apiKey) {
      return {
        success: false,
        error:
          "Tavily API key not configured. Set tavily_api_key in config.yaml (free at https://tavily.com)",
      };
    }

    const { query, count = 5, topic = "general" } = params;
    const maxResults = Math.min(Math.max(1, count), WEB_SEARCH_MAX_RESULTS);

    const client = tavily({ apiKey });
    const response = await client.search(query, {
      maxResults,
      topic,
      searchDepth: "basic",
      includeAnswer: true,
    });

    const results = response.results.map((r) => ({
      title: sanitizeForContext(r.title),
      url: r.url,
      content: sanitizeForContext(r.content),
      score: r.score,
    }));

    return {
      success: true,
      data: {
        query,
        answer: response.answer || undefined,
        results,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
