// src/agent/tools/web/fetch.ts

import { Type } from "@sinclair/typebox";
import { tavily } from "@tavily/core";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { WEB_FETCH_MAX_TEXT_LENGTH } from "../../../constants/limits.js";
import { sanitizeForContext } from "../../../utils/sanitize.js";
import { getErrorMessage } from "../../../utils/errors.js";

interface WebFetchParams {
  url: string;
  max_length?: number;
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

export const webFetchTool: Tool = {
  name: "web_fetch",
  description: "Fetch a web page and extract readable text. HTTP/HTTPS only.",
  category: "data-bearing",
  parameters: Type.Object({
    url: Type.String({ description: "URL to fetch (http or https only)" }),
    max_length: Type.Optional(
      Type.Number({
        description: `Max characters of extracted text (default ${WEB_FETCH_MAX_TEXT_LENGTH})`,
      })
    ),
  }),
};

export const webFetchExecutor: ToolExecutor<WebFetchParams> = async (
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

    const { url, max_length = WEB_FETCH_MAX_TEXT_LENGTH } = params;

    // Validate URL scheme
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { success: false, error: "Invalid URL" };
    }

    if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
      return {
        success: false,
        error: `Blocked URL scheme: ${parsed.protocol} — only http/https allowed`,
      };
    }

    const client = tavily({ apiKey });
    const response = await client.extract([url], {
      extractDepth: "basic",
    });

    if (!response.results?.length) {
      if (response.failedResults?.length) {
        return {
          success: false,
          error: `Failed to extract: ${response.failedResults[0].error}`,
        };
      }
      return { success: false, error: "No content extracted from URL" };
    }

    const result = response.results[0];
    let text = result.rawContent || "";

    const truncated = text.length > max_length;
    if (truncated) {
      text = text.slice(0, max_length);
    }

    return {
      success: true,
      data: {
        title: sanitizeForContext(result.title || parsed.hostname),
        text: sanitizeForContext(text),
        url,
        length: text.length,
        truncated,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
