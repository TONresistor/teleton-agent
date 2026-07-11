/**
 * TON Proxy built-in module.
 *
 * Manages the Tonutils-Proxy binary lifecycle:
 * - Auto-downloads from GitHub if not installed
 * - Starts/stops with the agent
 * - Exposes status tool for the LLM
 */

import type { PluginModule } from "../agent/tools/types.js";
import { TonProxyManager } from "./manager.js";
import { createLogger } from "../utils/logger.js";
import { tonProxyStatusTool, tonProxyStatusExecutor, setProxyManager } from "./tools.js";

const log = createLogger("TonProxyModule");

let manager: TonProxyManager | null = null;

/** Get the active proxy manager (for WebUI routes) */
export function getTonProxyManager(): TonProxyManager | null {
  return manager;
}

/** Set the proxy manager (for hot-toggle from WebUI config) */
export function setTonProxyManager(mgr: TonProxyManager | null): void {
  manager = mgr;
  setProxyManager(mgr);
}

const tonProxyModule: PluginModule = {
  name: "ton-proxy",
  version: "1.0.0",

  tools(config) {
    if (!config.ton_proxy?.enabled) return [];
    return [{ tool: tonProxyStatusTool, executor: tonProxyStatusExecutor }];
  },

  async start(context) {
    if (!context.config.ton_proxy?.enabled) return;

    const proxyConfig = context.config.ton_proxy;
    manager = new TonProxyManager({
      enabled: proxyConfig.enabled,
      port: proxyConfig.port,
      binary_path: proxyConfig.binary_path,
    });

    setProxyManager(manager);

    try {
      await manager.start();
      log.info(`TON Proxy started on port ${proxyConfig.port}`);
    } catch (error) {
      log.error({ err: error }, "Failed to start TON Proxy");
      // Non-fatal: agent continues without proxy
      setTonProxyManager(null);
    }
  },

  async stop() {
    if (manager) {
      await manager.stop();
      manager = null;
      setProxyManager(null);
    }
  },
};

export default tonProxyModule;
