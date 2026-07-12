import { Type } from "@sinclair/typebox";
import type { TSchema } from "@sinclair/typebox";
import type { Tool as PiAiTool } from "@earendil-works/pi-ai";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import type { ToolRegistry } from "../registry.js";
import { TELEGRAM_SEND_TOOLS } from "../../../constants/tools.js";
import { createLogger } from "../../../utils/logger.js";
import {
  rankNamespacesLexically,
  rankToolsLexically,
  type NamespaceSearchResult,
  type ToolNamespaceCatalogEntry,
} from "../tool-namespaces.js";

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
  category: "data-bearing",
  parameters: Type.Object({
    query: Type.String({
      description: "Natural language description of the capability you need",
      minLength: 1,
      maxLength: 512,
    }),
    namespace: Type.Optional(
      Type.String({
        description:
          "Optional namespace name from the advertised catalog, for example 'exec' or 'telegram.media'",
        minLength: 1,
        maxLength: 128,
      })
    ),
  }),
};

interface ToolSearchParams {
  query: string;
  namespace?: string;
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

    // ── 2. Permission-filtered namespace routing ──────────────────────────
    const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
    const availableNamespaceCatalog = registry.getNamespaceCatalog(
      context.isGroup,
      context.chatId,
      isAdmin,
      context.senderId
    );
    const namespaceCatalog = context.isGuest
      ? availableNamespaceCatalog
          .map((entry) => ({
            ...entry,
            toolNames: entry.toolNames.filter((name) => !TELEGRAM_SEND_TOOLS.has(name)),
          }))
          .filter((entry) => entry.toolNames.length > 0)
      : availableNamespaceCatalog;
    const toolIndex = registry.getToolIndex();
    const namespaceCandidates = selectRequestedNamespace(namespaceCatalog, params.namespace);
    let namespaceResults: NamespaceSearchResult[] = [];
    const namespaceLimit = Math.min(3, namespaceCandidates.length);

    if (namespaceLimit > 0) {
      if (params.namespace) {
        const requested = normalizeNamespace(params.namespace);
        const exact = namespaceCandidates.find((entry) => entry.name === requested);
        if (exact) {
          namespaceResults = [{ ...exact, score: 1, keywordScore: 1 }];
        }
      }
      if (namespaceResults.length === 0 && toolIndex) {
        try {
          namespaceResults = await toolIndex.searchNamespaces(
            `${params.namespace ?? ""} ${query}`.trim(),
            queryEmbedding,
            namespaceCandidates,
            namespaceLimit
          );
        } catch (err) {
          log.warn({ err }, "tool_search: namespace routing failed, using lexical fallback");
        }
      }
      if (namespaceResults.length === 0) {
        namespaceResults = rankNamespacesLexically(
          `${params.namespace ?? ""} ${query}`.trim(),
          namespaceCandidates,
          namespaceLimit
        );
      }
      if (namespaceResults.length === 0 && namespaceCandidates.length === 1) {
        namespaceResults = [{ ...namespaceCandidates[0], score: 1 }];
      }
    }

    // ── 3. Search only inside the selected namespace working set ──────────
    let searchResults: Array<{ name: string; description: string }> = [];
    const allowedNames = new Set(namespaceResults.flatMap((entry) => entry.toolNames));
    if (toolIndex?.isIndexed && allowedNames.size > 0) {
      try {
        searchResults = await toolIndex.searchWithin(
          query,
          queryEmbedding,
          allowedNames,
          maxResults * 3
        );
      } catch (err) {
        log.warn({ err }, "tool_search: namespace tool search failed");
      }
    }

    if (searchResults.length === 0 && allowedNames.size > 0) {
      searchResults = rankToolsLexically(
        query,
        registry.getAll().filter((tool) => allowedNames.has(tool.name)),
        maxResults * 3
      );
    }

    // An explicit namespace is itself a strong routing signal. If lexical/vector
    // ranking is unavailable, return its bounded tool set instead of failing closed.
    if (searchResults.length === 0 && params.namespace && allowedNames.size > 0) {
      searchResults = registry
        .getAll()
        .filter((tool) => allowedNames.has(tool.name))
        .slice(0, maxResults * 3)
        .map((tool) => ({ name: tool.name, description: tool.description ?? "" }));
    }

    // Fall back globally only when hierarchical routing produced no usable tool.
    // Mixing unrelated global candidates into a successful namespace result can
    // expose actions the user did not ask for and degrades routing precision.
    if (searchResults.length === 0 && !params.namespace && toolIndex?.isIndexed) {
      try {
        searchResults = await toolIndex.search(query, queryEmbedding, maxResults * 3);
      } catch (err) {
        log.warn({ err }, "tool_search: global fallback failed");
      }
    }

    // ── 4. Defense-in-depth scope / mode / permission filtering ───────────
    const filtered = searchResults
      .filter((result) => !context.isGuest || !TELEGRAM_SEND_TOOLS.has(result.name))
      .filter((r) =>
        registry.passesFilters(r.name, context.isGroup, context.chatId, isAdmin, context.senderId)
      )
      .slice(0, maxResults);

    // ── 5. Lookup full TypeBox schemas from registry ───────────────────────
    const tools: DiscoveredTool[] = [];
    for (const r of filtered) {
      const schema = registry.getToolSchema(r.name);
      if (schema) {
        tools.push({ name: r.name, description: r.description, parameters: schema });
      }
    }

    // ── 6. Logging ─────────────────────────────────────────────────────────
    const latencyMs = Date.now() - start;
    const namespaceNames = namespaceResults.map((entry) => entry.name).join(", ");
    if (tools.length === 0) {
      log.warn(
        `tool_search: no results (queryLength=${query.length}, namespaces=[${namespaceNames}], ${latencyMs}ms)`
      );
    } else {
      const names = tools.map((t) => t.name).join(", ");
      log.info(
        `tool_search queryLength=${query.length} namespaces=[${namespaceNames}] results=${tools.length} tools=[${names}] latency=${latencyMs}ms`
      );
    }

    return {
      success: true,
      data: {
        tools_found: tools.length,
        namespaces_searched: namespaceResults.map((entry) => ({
          name: entry.name,
          score: Number(entry.score.toFixed(4)),
        })),
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

function selectRequestedNamespace(
  catalog: ToolNamespaceCatalogEntry[],
  requestedNamespace?: string
): ToolNamespaceCatalogEntry[] {
  const requested = normalizeNamespace(requestedNamespace);
  if (!requested) return catalog;
  const exact = catalog.filter((entry) => entry.name === requested);
  if (exact.length > 0) return exact;
  const nested = catalog.filter(
    (entry) => entry.name.startsWith(`${requested}.`) || requested.startsWith(`${entry.name}.`)
  );
  return nested;
}

function normalizeNamespace(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}
