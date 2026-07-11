// src/agent/tools/web/search.ts

import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor } from "../types.js";
import { WEB_SEARCH_MAX_RESULTS } from "../../../constants/limits.js";
import { sanitizeForContext } from "../../../utils/sanitize.js";
import { resolveTavily } from "./tavily.js";

interface WebSearchParams {
  query: string;
  count?: number;
  topic?: "general" | "news" | "finance";
}

export const webSearchTool: Tool = {
  name: "web_search",
  description:
    "Search the general internet via Tavily. Use ONLY after domain-specific tools fail or don't exist for the query. NOT for: .ton domains (dns_resolve), jetton prices (jetton_price/ton_price), Telegram messages (telegram_search_messages/session_search), token addresses (stonfi_search), DEX rates (dex_quote). Topic options: general, news, finance.",
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

export const webSearchExecutor: ToolExecutor<WebSearchParams> = async (params, context) => {
  const tav = resolveTavily(context);
  if (!tav.ok) return tav.error;

  const { query, count = 5, topic = "general" } = params;
  const maxResults = Math.min(Math.max(1, count), WEB_SEARCH_MAX_RESULTS);

  const client = tav.client;
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
};
