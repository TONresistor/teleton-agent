import type { Config } from "./config/schema.js";
import type { ToolRegistry } from "./agent/tools/registry.js";
import type { SDKDependencies } from "./sdk/index.js";
import type { HookRegistry } from "./sdk/hooks/registry.js";
import { loadEnhancedPlugins } from "./agent/tools/plugin-loader.js";
import type { PluginModule } from "./agent/tools/types.js";
import { getProviderMetadata, type SupportedProvider } from "./config/providers.js";
import { getDatabase } from "./memory/index.js";
import type { EmbeddingProvider } from "./memory/embeddings/provider.js";
import { createLogger } from "./utils/logger.js";
import { getErrorMessage } from "./utils/errors.js";

const log = createLogger("PluginOrchestrator");

export interface OrchestratorResult {
  pluginNames: string[];
  pluginToolCount: number;
  mcpServerNames: string[];
  hookRegistry: HookRegistry;
  externalModules: PluginModule[];
  toolCount: number;
  dispose: () => void;
}

export class PluginOrchestrator {
  constructor(
    private registry: ToolRegistry,
    private config: Config,
    private sdkDeps: SDKDependencies,
    private embedder: EmbeddingProvider
  ) {}

  async loadAll(
    builtinNames: string[],
    moduleNames: string[],
    mcpConnections: { serverName: string }[]
  ): Promise<OrchestratorResult> {
    const db = getDatabase().getDb();

    const { modules: externalModules, hookRegistry } = await loadEnhancedPlugins(
      this.config,
      builtinNames,
      this.sdkDeps,
      db
    );
    let pluginToolCount = 0;
    const pluginNames: string[] = [];
    const healthyExternalModules: PluginModule[] = [];
    for (const mod of externalModules) {
      try {
        mod.configure?.(this.config);
        mod.migrate?.(db);
        const tools = mod.tools(this.config);
        if (tools.length > 0) {
          pluginToolCount += this.registry.registerPluginTools(mod.name, tools);
          pluginNames.push(mod.name);
        }
        healthyExternalModules.push(mod);
      } catch (error) {
        log.error(`❌ Plugin "${mod.name}" failed to load: ${getErrorMessage(error)}`);
        this.registry.removePluginTools(mod.name);
        hookRegistry.unregister(mod.name);
        try {
          await mod.stop?.();
        } catch (cleanupError) {
          log.error(`❌ Plugin "${mod.name}" cleanup failed: ${getErrorMessage(cleanupError)}`);
        }
      }
    }

    let toolCount = this.registry.count;
    let disposeToolIndexSubscription = (): void => {};

    // Load MCP servers
    const mcpServerNames: string[] = [];
    if (Object.keys(this.config.mcp.servers).length > 0) {
      const { registerMcpTools } = await import("./agent/tools/mcp-loader.js");
      if (mcpConnections.length > 0) {
        const mcp = await registerMcpTools(
          mcpConnections as Parameters<typeof registerMcpTools>[0],
          this.registry
        );
        if (mcp.count > 0) {
          toolCount = this.registry.count;
          mcpServerNames.push(...mcp.names);
          log.info(
            `🔌 MCP: ${mcp.count} tools from ${mcp.names.length} server(s) (${mcp.names.join(", ")})`
          );
        }
      }
    }

    // Initialize tool config from database
    this.registry.loadConfigFromDB(db);

    // Initialize Tool RAG index
    if (this.config.tool_rag.enabled) {
      const { ToolIndex } = await import("./agent/tools/tool-index.js");
      const toolIndex = new ToolIndex(db, this.embedder, getDatabase().isVectorSearchReady(), {
        topK: this.config.tool_rag.top_k,
        alwaysInclude: this.config.tool_rag.always_include,
        skipUnlimitedProviders: this.config.tool_rag.skip_unlimited_providers,
      });
      toolIndex.ensureSchema();
      this.registry.setToolIndex(toolIndex);

      disposeToolIndexSubscription = this.registry.onToolsChanged(async (removed, added) => {
        await toolIndex.reindexTools(removed, added);
      });
    }

    // Provider info and tool limit check
    const provider = (this.config.agent.provider || "anthropic") as SupportedProvider;
    const providerMeta = getProviderMetadata(provider);
    const allNames = [...moduleNames, ...pluginNames, ...mcpServerNames];
    toolCount = this.registry.count;
    log.info(
      `🔌 ${toolCount} tools loaded (${allNames.join(", ")})${pluginToolCount > 0 ? ` — ${pluginToolCount} from plugins` : ""}`
    );
    if (providerMeta.toolLimit !== null && toolCount > providerMeta.toolLimit) {
      log.warn(
        `⚠️ Tool count (${toolCount}) exceeds ${providerMeta.displayName} limit (${providerMeta.toolLimit})`
      );
    }

    return {
      pluginNames,
      pluginToolCount,
      mcpServerNames,
      hookRegistry,
      externalModules: healthyExternalModules,
      toolCount,
      dispose: disposeToolIndexSubscription,
    };
  }
}
