import type { Hono } from "hono";
import type { WebUIServerDeps } from "../types.js";

import { createStatusRoutes } from "./status.js";
import { createToolsRoutes } from "./tools.js";
import { createLogsRoutes } from "./logs.js";
import { createMemoryRoutes } from "./memory.js";
import { createSoulRoutes } from "./soul.js";
import { createPluginsRoutes } from "./plugins.js";
import { createMcpRoutes } from "./mcp.js";
import { createWorkspaceRoutes } from "./workspace.js";
import { createOperationsRoutes } from "./operations.js";
import { createTasksRoutes } from "./tasks.js";
import { createConfigRoutes } from "./config.js";
import { createMarketplaceRoutes } from "./marketplace.js";
import { createHooksRoutes } from "./hooks.js";
import { createTonProxyRoutes } from "./ton-proxy.js";
import { createGocoonRoutes } from "./gocoon.js";

/** A route factory shared by the WebUI and Management API servers. */
export type RouteFactory = (deps: WebUIServerDeps) => Hono;

/**
 * Route factories common to both the WebUI server (mounted under `/api/*`)
 * and the Management API server (mounted under `/v1/*`). Listing them once
 * here keeps the two mount sites in sync — adding or removing a shared route
 * is a single edit instead of two.
 *
 * Server-specific routes (WebUI: conversations, wallet, agent/mode; API:
 * agent, system, auth, api-logs, api-memory, setup) stay mounted explicitly
 * in each server.
 */
export const SHARED_ROUTE_FACTORIES: ReadonlyArray<[string, RouteFactory]> = [
  ["status", createStatusRoutes],
  ["tools", createToolsRoutes],
  ["logs", createLogsRoutes],
  ["memory", createMemoryRoutes],
  ["soul", createSoulRoutes],
  ["plugins", createPluginsRoutes],
  ["mcp", createMcpRoutes],
  ["workspace", createWorkspaceRoutes],
  ["tasks", createTasksRoutes],
  ["operations", createOperationsRoutes],
  ["config", createConfigRoutes],
  ["marketplace", createMarketplaceRoutes],
  ["hooks", createHooksRoutes],
  ["ton-proxy", createTonProxyRoutes],
  ["gocoon", createGocoonRoutes],
];
