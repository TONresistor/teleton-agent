import type { AgentRuntime } from "../agent/runtime.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { PluginModule, PluginContext } from "../agent/tools/types.js";
import type { McpConnection } from "../agent/tools/mcp-loader.js";
import type { Config } from "../config/index.js";
import type { AgentLifecycle } from "../agent/lifecycle.js";
import type { MemorySystem } from "../memory/index.js";
import { getDatabase } from "../memory/index.js";
import type { SDKDependencies } from "../sdk/index.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import type { UserHookEvaluator } from "../agent/hooks/user-hook-evaluator.js";
import type { WebUIServerDeps } from "../webui/types.js";

export interface ServerDepsInput {
  agent: AgentRuntime;
  bridge: ITelegramBridge;
  memory: MemorySystem;
  toolRegistry: ToolRegistry;
  modules: PluginModule[];
  mcpConnections: McpConnection[];
  config: Config;
  configPath: string;
  lifecycle: AgentLifecycle;
  sdkDeps: SDKDependencies;
  userHookEvaluator: UserHookEvaluator | null;
  rewireHooks: () => void;
  stopGocoonRunner: () => boolean;
}

/** Build the shared dependency boundary used by WebUI and Management API servers. */
export function createServerDeps(input: ServerDepsInput): WebUIServerDeps {
  const mcpServers = () =>
    Object.entries(input.config.mcp.servers).map(([name, serverConfig]) => {
      const type = serverConfig.command
        ? ("stdio" as const)
        : serverConfig.url
          ? ("streamable-http" as const)
          : ("sse" as const);
      const moduleTools = input.toolRegistry.getModuleTools(`mcp_${name}`);
      return {
        name,
        type,
        target: serverConfig.command ?? serverConfig.url ?? "",
        scope: serverConfig.scope ?? "always",
        enabled: serverConfig.enabled ?? true,
        connected: input.mcpConnections.some((connection) => connection.serverName === name),
        toolCount: moduleTools.length,
        tools: moduleTools.map((tool) => tool.name),
        envKeys: Object.keys(serverConfig.env ?? {}),
      };
    });
  const pluginContext: PluginContext = {
    bridge: input.bridge,
    db: getDatabase().getDb(),
    config: input.config,
  };

  return {
    agent: input.agent,
    bridge: input.bridge,
    memory: input.memory,
    toolRegistry: input.toolRegistry,
    plugins: input.modules
      .filter((module) => input.toolRegistry.isPluginModule(module.name))
      .map((module) => ({ name: module.name, version: module.version ?? "0.0.0" })),
    mcpServers,
    config: input.config.webui,
    configPath: input.configPath,
    lifecycle: input.lifecycle,
    marketplace: {
      modules: input.modules,
      config: input.config,
      sdkDeps: input.sdkDeps,
      pluginContext,
      loadedModuleNames: input.modules.map((module) => module.name),
      rewireHooks: input.rewireHooks,
    },
    userHookEvaluator: input.userHookEvaluator,
    gocoonControl: { stopRunner: input.stopGocoonRunner },
  };
}
