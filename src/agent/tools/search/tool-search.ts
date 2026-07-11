import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import type { Tool as PiAiTool } from "@earendil-works/pi-ai";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { ToolRegistry } from "../registry.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("ToolSearch");

/**
 * Meta-tool for lazy-loading tools on demand.
 *
 * The LLM receives ~10 core tools in its initial context. When it needs a
 * capability beyond those, it calls tool_search with a natural-language query.
 * The executor searches the ToolIndex (vec0 + FTS5 hybrid), filters by scope,
 * and returns up to `max_results` tools with full TypeBox schemas.
 *
 * The runtime then injects those schemas into the live `tools[]` array so the
 * LLM can call them in the very next agentic iteration.
 */
export const toolSearchTool: Tool = {
  name: "tool_search",
  description:
    "Search for available tools by describing what you need to do. " +
    "Returns matching tools with their full parameter schemas so you can call them. " +
    "Use when you need a capability not in your current tool set. " +
    "Examples: 'send a sticker', 'check TON balance', 'create a poll', 'manage DNS'.",
  parameters: Type.Object({
    query: Type.String({
      description: "Natural language description of the capability you need",
      minLength: 1,
      maxLength: 512,
    }),
  }),
};

interface ToolSearchParams {
  query: string;
}

/** Shape returned inside ToolResult.data.tools — also compatible with PiAiTool */
interface DiscoveredTool {
  name: string;
  description: string;
  parameters: TSchema;
}

/**
 * Factory that creates the tool_search executor with dependencies injected via closure.
 *
 * The executor lazily reads `registry.getToolIndex()` and `registry.getEmbedder()` at
 * call time so it works correctly even when those are set after registration (i.e. during
 * startup in startAgent / initializeContextBuilder).
 *
 * @param registry  The live ToolRegistry (captures by reference).
 * @param maxResults  Maximum tools to return per call (default: 5, per spec D8).
 */
export function createToolSearchExecutor(
  registry: ToolRegistry,
  maxResults = 5
): ToolExecutor<ToolSearchParams> {
  return async (params, context): Promise<ToolResult> => {
    const start = Date.now();
    const { query } = params;

    // ── 1. Generate query embedding (hybrid search) ──────────────────────
    const embedder = registry.getEmbedder();
    let queryEmbedding: number[] = [];
    if (embedder) {
      try {
        queryEmbedding = await embedder.embedQuery(query);
      } catch (err) {
        log.warn({ err }, "tool_search: embedding failed, falling back to FTS5-only");
      }
    }

    // ── 2. Hybrid search via ToolIndex (vec0 + FTS5) ─────────────────────
    const toolIndex = registry.getToolIndex();
    let searchResults: Array<{ name: string; description: string }> = [];
    if (toolIndex?.isIndexed) {
      try {
        searchResults = await toolIndex.search(query, queryEmbedding, maxResults * 3);
      } catch (err) {
        log.warn({ err }, "tool_search: index search failed");
      }
    }

    // ── 3. Scope / mode / permission filtering ────────────────────────────
    const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
    const filtered = searchResults
      .filter((r) =>
        registry.passesFilters(r.name, context.isGroup, context.chatId, isAdmin, context.senderId)
      )
      .slice(0, maxResults);

    // ── 4. Lookup full TypeBox schemas from registry ───────────────────────
    const tools: DiscoveredTool[] = [];
    for (const r of filtered) {
      const schema = registry.getToolSchema(r.name);
      if (schema) {
        tools.push({ name: r.name, description: r.description, parameters: schema });
      }
    }

    // ── 5. Logging (T8) ───────────────────────────────────────────────────
    const latencyMs = Date.now() - start;
    if (tools.length === 0) {
      log.warn(`tool_search: no results (queryLength=${query.length}, ${latencyMs}ms)`);
    } else {
      const names = tools.map((t) => t.name).join(", ");
      log.info(
        `tool_search queryLength=${query.length} results=${tools.length} tools=[${names}] latency=${latencyMs}ms`
      );
    }

    return {
      success: true,
      data: {
        tools_found: tools.length,
        // Cast needed: DiscoveredTool is structurally identical to PiAiTool but inferred differently.
        tools: tools as unknown as PiAiTool[],
        hint:
          tools.length === 0
            ? "No tools found. Try rephrasing your query."
            : "These tools are now available. Call them directly.",
      },
    };
  };
}
