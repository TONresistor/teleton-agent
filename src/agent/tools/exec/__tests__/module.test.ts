import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { ensureSchema } from "../../../../memory/schema.js";
import type { Config } from "../../../../config/schema.js";
import { ConfigSchema } from "../../../../config/schema.js";
import execModule from "../module.js";

function makeConfig(execOverrides?: Record<string, unknown>): Config {
  return ConfigSchema.parse({
    agent: { provider: "anthropic", api_key: "test" },
    telegram: { api_id: 1, api_hash: "a", phone: "+1" },
    capabilities: {
      exec: {
        mode: "yolo",
        scope: "admin-only",
        ...execOverrides,
      },
    },
  });
}

describe("execModule", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  it("returns 4 tools when enabled + Linux", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig();
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.tool.name).sort()).toEqual([
      "exec_install",
      "exec_run",
      "exec_service",
      "exec_status",
    ]);

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("returns empty tools when mode is off", () => {
    const config = makeConfig({ mode: "off" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(0);
  });

  it("returns empty tools on non-Linux", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "darwin" });

    const config = makeConfig();
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools).toHaveLength(0);

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("sets scope to admin-only when config scope is admin-only", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig({ scope: "admin-only" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools[0].scope).toBe("admin-only");

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });

  it("sets scope to always when config scope is all", () => {
    const origPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "linux" });

    const config = makeConfig({ scope: "all" });
    execModule.configure!(config);
    execModule.migrate!(db);
    const tools = execModule.tools(config);

    expect(tools[0].scope).toBe("always");

    if (origPlatform) Object.defineProperty(process, "platform", origPlatform);
    else Object.defineProperty(process, "platform", { value: "linux" });
  });
});
