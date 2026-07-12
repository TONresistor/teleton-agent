import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";
import type { AgentRuntime } from "../../agent/runtime.js";
import { CONFIGURABLE_KEYS } from "../../config/configurable-keys.js";
import { ConfigSchema, type Config } from "../../config/schema.js";
import type { ITelegramBridge } from "../bridge-interface.js";
import { AdminHandler } from "../admin.js";

describe("AdminHandler config persistence", () => {
  let tempDir: string;
  let configPath: string;
  let config: Config;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "teleton-admin-config-"));
    configPath = join(tempDir, "config.yaml");
    config = ConfigSchema.parse({
      agent: { provider: "codex", model: "gpt-5.6-terra" },
      telegram: {
        mode: "user",
        api_id: 1,
        api_hash: "test",
        phone: "+10000000000",
        admin_ids: [111],
        dm_policy: "admin-only",
        group_policy: "admin-only",
      },
    });
    writeFileSync(configPath, stringify(config), "utf8");
  });

  afterEach(() => rmSync(tempDir, { recursive: true, force: true }));

  function createHandler(path = configPath): AdminHandler {
    const bridge = {} as ITelegramBridge;
    const agent = {
      getConfig: vi.fn(() => config),
    } as unknown as AgentRuntime;
    return new AdminHandler(bridge, config.telegram, agent, path);
  }

  async function run(handler: AdminHandler, command: string, args: string[]) {
    return handler.handleCommand({ command, args, chatId: "", senderId: 0 }, "chat-1", 111);
  }

  function readPersisted(): Config {
    return ConfigSchema.parse(parse(readFileSync(configPath, "utf8")));
  }

  it("persists model, loop, policy, and RAG changes before updating runtime", async () => {
    const handler = createHandler();

    expect(await run(handler, "model", ["gpt-5.6-sol"])).not.toContain("Error");
    expect(await run(handler, "loop", ["50"])).not.toContain("Error");
    expect(await run(handler, "policy", ["dm", "open"])).not.toContain("Error");
    expect(await run(handler, "policy", ["group", "allowlist"])).not.toContain("Error");
    expect(await run(handler, "rag", ["topk", "50"])).not.toContain("Error");
    expect(await run(handler, "rag", [])).not.toContain("Error");
    expect(await run(handler, "guest", ["on"])).not.toContain("Error");

    const raw = readPersisted();
    expect(raw.agent.model).toBe("gpt-5.6-sol");
    expect(raw.agent.max_agentic_iterations).toBe(50);
    expect(raw.telegram.dm_policy).toBe("open");
    expect(raw.telegram.group_policy).toBe("allowlist");
    expect(raw.tool_rag.top_k).toBe(50);
    expect(raw.tool_rag.enabled).toBe(false);
    expect(raw.telegram.guest_mode).toBe(true);

    expect(config.agent.model).toBe("gpt-5.6-sol");
    expect(config.agent.max_agentic_iterations).toBe(50);
    expect(config.telegram.dm_policy).toBe("open");
    expect(config.telegram.group_policy).toBe("allowlist");
    expect(config.tool_rag.top_k).toBe(50);
    expect(config.tool_rag.enabled).toBe(false);
    expect(config.telegram.guest_mode).toBe(true);
  });

  it("does not mutate runtime when the config cannot be written", async () => {
    const handler = createHandler(join(tempDir, "missing", "config.yaml"));

    const response = await run(handler, "model", ["gpt-5.6-sol"]);

    expect(response).toContain("Error saving config");
    expect(config.agent.model).toBe("gpt-5.6-terra");
  });

  it("rejects malformed loop values without mutating runtime or disk", async () => {
    const handler = createHandler();

    expect(await run(handler, "loop", ["10invalid"])).toContain("Usage: /loop <1-50>");
    expect(await run(handler, "rag", ["topk", "50invalid"])).toContain("Usage: /rag topk <5-200>");

    expect(config.agent.model).toBe("gpt-5.6-terra");
    expect(config.agent.max_agentic_iterations).toBe(5);
    expect(config.tool_rag.top_k).toBe(35);
    expect(readPersisted().agent.model).toBe("gpt-5.6-terra");
    expect(readPersisted().agent.max_agentic_iterations).toBe(5);
  });

  it("aligns the configurable loop limit with the Telegram command", () => {
    const meta = CONFIGURABLE_KEYS["agent.max_agentic_iterations"];
    expect(meta.validate("50")).toBeUndefined();
    expect(meta.validate("51")).toBeDefined();
  });
});
