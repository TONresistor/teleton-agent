import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ToolRegistry } from "../registry.js";
import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolContext, ToolScope } from "../types.js";
import type { ToolCall } from "@mariozechner/pi-ai";

// Mock modules
vi.mock("@mariozechner/pi-ai", () => ({
  validateToolCall: vi.fn((tools, toolCall) => toolCall.arguments),
}));

vi.mock("../module-permissions.js", () => ({
  ModulePermissions: vi.fn(),
}));

vi.mock("../../../constants/timeouts.js", () => ({
  TOOL_EXECUTION_TIMEOUT_MS: 90_000,
}));

describe("ToolRegistry", () => {
  let registry: ToolRegistry;
  let db: InstanceType<typeof Database>;
  let mockContext: ToolContext;

  // Mock tool definitions
  const createMockTool = (name: string, category?: "data-bearing" | "action"): Tool => ({
    name,
    description: `Test tool: ${name}`,
    parameters: Type.Object({
      message: Type.String(),
    }),
    category,
  });

  const createMockExecutor = (returnValue: any = { success: true }): ToolExecutor => {
    return vi.fn(async () => returnValue);
  };

  beforeEach(() => {
    registry = new ToolRegistry();
    db = new Database(":memory:");

    // Create tool_config table for database tests
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_config (
        tool_name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        scope TEXT,
        updated_at INTEGER NOT NULL,
        updated_by INTEGER
      )
    `);

    mockContext = {
      bridge: {} as any,
      db,
      chatId: "test-chat",
      senderId: 12345,
      isGroup: false,
      config: {
        telegram: {
          admin_ids: [99999],
        },
      } as any,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
    db.close();
  });

  // ---------- Basic registration ----------

  describe("register()", () => {
    it("should register a tool successfully", () => {
      const tool = createMockTool("test_tool");
      const executor = createMockExecutor();

      registry.register(tool, executor);

      expect(registry.has("test_tool")).toBe(true);
      expect(registry.count).toBe(1);
    });

    it("should register a tool with scope", () => {
      const tool = createMockTool("test_dm_only");
      const executor = createMockExecutor();

      registry.register(tool, executor, "dm-only");

      expect(registry.has("test_dm_only")).toBe(true);
      expect(registry.count).toBe(1);
    });

    it("should throw error when registering duplicate tool name", () => {
      const tool = createMockTool("duplicate_tool");
      const executor = createMockExecutor();

      registry.register(tool, executor);

      expect(() => {
        registry.register(tool, executor);
      }).toThrow('Tool "duplicate_tool" is already registered');
    });

    it("should invalidate cache after registration", () => {
      const tool1 = createMockTool("tool1");
      const tool2 = createMockTool("tool2");

      registry.register(tool1, createMockExecutor());
      const firstCache = registry.getAll();

      registry.register(tool2, createMockExecutor());
      const secondCache = registry.getAll();

      expect(firstCache.length).toBe(1);
      expect(secondCache.length).toBe(2);
    });

    it("should extract module name from tool name", () => {
      const tool = createMockTool("telegram_send_message");
      registry.register(tool, createMockExecutor());

      const modules = registry.getAvailableModules();
      expect(modules).toContain("telegram");
    });
  });

  // ---------- Retrieval methods ----------

  describe("has()", () => {
    it("should return true for registered tool", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      expect(registry.has("test_tool")).toBe(true);
    });

    it("should return false for non-existent tool", () => {
      expect(registry.has("non_existent")).toBe(false);
    });
  });

  describe("count", () => {
    it("should return 0 for empty registry", () => {
      expect(registry.count).toBe(0);
    });

    it("should return correct count after registrations", () => {
      registry.register(createMockTool("tool1"), createMockExecutor());
      expect(registry.count).toBe(1);

      registry.register(createMockTool("tool2"), createMockExecutor());
      expect(registry.count).toBe(2);

      registry.register(createMockTool("tool3"), createMockExecutor());
      expect(registry.count).toBe(3);
    });
  });

  describe("getAll()", () => {
    it("should return empty array for empty registry", () => {
      expect(registry.getAll()).toEqual([]);
    });

    it("should return all registered tools", () => {
      const tool1 = createMockTool("tool1");
      const tool2 = createMockTool("tool2");
      const tool3 = createMockTool("tool3");

      registry.register(tool1, createMockExecutor());
      registry.register(tool2, createMockExecutor());
      registry.register(tool3, createMockExecutor());

      const all = registry.getAll();
      expect(all).toHaveLength(3);
      expect(all).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "tool1" }),
          expect.objectContaining({ name: "tool2" }),
          expect.objectContaining({ name: "tool3" }),
        ])
      );
    });

    it("should cache results on subsequent calls", () => {
      const tool = createMockTool("tool1");
      registry.register(tool, createMockExecutor());

      const first = registry.getAll();
      const second = registry.getAll();

      expect(first).toBe(second); // Same reference
    });
  });

  describe("getToolCategory()", () => {
    it("should return correct category for data-bearing tool", () => {
      const tool = createMockTool("test_tool", "data-bearing");
      registry.register(tool, createMockExecutor());

      expect(registry.getToolCategory("test_tool")).toBe("data-bearing");
    });

    it("should return correct category for action tool", () => {
      const tool = createMockTool("test_tool", "action");
      registry.register(tool, createMockExecutor());

      expect(registry.getToolCategory("test_tool")).toBe("action");
    });

    it("should return undefined for tool without category", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      expect(registry.getToolCategory("test_tool")).toBeUndefined();
    });

    it("should return undefined for non-existent tool", () => {
      expect(registry.getToolCategory("non_existent")).toBeUndefined();
    });
  });

  // ---------- Module methods ----------

  describe("getAvailableModules()", () => {
    it("should return empty array for empty registry", () => {
      expect(registry.getAvailableModules()).toEqual([]);
    });

    it("should return unique module names sorted", () => {
      registry.register(createMockTool("telegram_send"), createMockExecutor());
      registry.register(createMockTool("telegram_edit"), createMockExecutor());
      registry.register(createMockTool("ton_balance"), createMockExecutor());
      registry.register(createMockTool("workspace_read"), createMockExecutor());

      const modules = registry.getAvailableModules();
      expect(modules).toEqual(["telegram", "ton", "workspace"]);
    });
  });

  describe("getModuleToolCount()", () => {
    it("should return 0 for non-existent module", () => {
      expect(registry.getModuleToolCount("non_existent")).toBe(0);
    });

    it("should return correct count for module with tools", () => {
      registry.register(createMockTool("telegram_send"), createMockExecutor());
      registry.register(createMockTool("telegram_edit"), createMockExecutor());
      registry.register(createMockTool("telegram_delete"), createMockExecutor());
      registry.register(createMockTool("ton_balance"), createMockExecutor());

      expect(registry.getModuleToolCount("telegram")).toBe(3);
      expect(registry.getModuleToolCount("ton")).toBe(1);
    });
  });

  describe("getModuleTools()", () => {
    it("should return empty array for non-existent module", () => {
      expect(registry.getModuleTools("non_existent")).toEqual([]);
    });

    it("should return tools with correct scope", () => {
      registry.register(createMockTool("telegram_send"), createMockExecutor(), "always");
      registry.register(createMockTool("telegram_wallet"), createMockExecutor(), "dm-only");
      registry.register(createMockTool("telegram_kick"), createMockExecutor(), "group-only");

      const tools = registry.getModuleTools("telegram");
      expect(tools).toHaveLength(3);
      expect(tools).toEqual([
        { name: "telegram_kick", scope: "group-only" },
        { name: "telegram_send", scope: "always" },
        { name: "telegram_wallet", scope: "dm-only" },
      ]);
    });
  });

  // ---------- Scope filtering ----------

  describe("getForContext()", () => {
    beforeEach(() => {
      registry.register(createMockTool("always_tool"), createMockExecutor(), "always");
      registry.register(createMockTool("dm_only_tool"), createMockExecutor(), "dm-only");
      registry.register(createMockTool("group_only_tool"), createMockExecutor(), "group-only");
      registry.register(createMockTool("admin_only_tool"), createMockExecutor(), "admin-only");
    });

    it("should filter dm-only tools in group context", () => {
      const tools = registry.getForContext(true, null);
      const names = tools.map((t) => t.name);

      expect(names).toContain("always_tool");
      expect(names).toContain("group_only_tool");
      expect(names).not.toContain("dm_only_tool");
    });

    it("should filter group-only tools in DM context", () => {
      const tools = registry.getForContext(false, null);
      const names = tools.map((t) => t.name);

      expect(names).toContain("always_tool");
      expect(names).toContain("dm_only_tool");
      expect(names).not.toContain("group_only_tool");
    });

    it("should filter admin-only tools for non-admin users", () => {
      const tools = registry.getForContext(false, null, undefined, false);
      const names = tools.map((t) => t.name);

      expect(names).not.toContain("admin_only_tool");
    });

    it("should include admin-only tools for admin users", () => {
      const tools = registry.getForContext(false, null, undefined, true);
      const names = tools.map((t) => t.name);

      expect(names).toContain("admin_only_tool");
    });

    it("should truncate to tool limit when exceeded", () => {
      const tools = registry.getForContext(false, 2);
      expect(tools.length).toBe(2);
    });

    it("should not truncate when under tool limit", () => {
      const tools = registry.getForContext(false, 100);
      expect(tools.length).toBe(2); // always, dm-only (admin-only filtered out because isAdmin=undefined)
    });
  });

  describe("getForProvider()", () => {
    beforeEach(() => {
      registry.register(createMockTool("tool1"), createMockExecutor());
      registry.register(createMockTool("tool2"), createMockExecutor());
      registry.register(createMockTool("tool3"), createMockExecutor());
    });

    it("should return all tools when limit is null", () => {
      const tools = registry.getForProvider(null);
      expect(tools.length).toBe(3);
    });

    it("should return all tools when under limit", () => {
      const tools = registry.getForProvider(10);
      expect(tools.length).toBe(3);
    });

    it("should truncate when exceeding limit", () => {
      const tools = registry.getForProvider(2);
      expect(tools.length).toBe(2);
    });
  });

  // ---------- Tool execution ----------

  describe("execute()", () => {
    it("should execute tool successfully", async () => {
      const tool = createMockTool("test_tool");
      const mockResult = { success: true, data: "result" };
      const executor = createMockExecutor(mockResult);

      registry.register(tool, executor);

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "test_tool",
        arguments: { message: "hello" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result).toEqual(mockResult);
      expect(executor).toHaveBeenCalledWith({ message: "hello" }, mockContext);
    });

    it("should return error for non-existent tool", async () => {
      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "non_existent",
        arguments: {},
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown tool: non_existent");
    });

    it("should enforce dm-only scope in group context", async () => {
      const tool = createMockTool("dm_tool");
      registry.register(tool, createMockExecutor(), "dm-only");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "dm_tool",
        arguments: { message: "test" },
      };

      const groupContext = { ...mockContext, isGroup: true };
      const result = await registry.execute(toolCall, groupContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("not available in group chats");
    });

    it("should enforce group-only scope in DM context", async () => {
      const tool = createMockTool("group_tool");
      registry.register(tool, createMockExecutor(), "group-only");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "group_tool",
        arguments: { message: "test" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("only available in group chats");
    });

    it("should enforce admin-only scope for non-admin", async () => {
      const tool = createMockTool("admin_tool");
      registry.register(tool, createMockExecutor(), "admin-only");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "admin_tool",
        arguments: { message: "test" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("restricted to admin users");
    });

    it("should allow admin-only tools for admin users", async () => {
      const tool = createMockTool("admin_tool");
      const mockResult = { success: true };
      registry.register(tool, createMockExecutor(mockResult), "admin-only");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "admin_tool",
        arguments: { message: "test" },
      };

      const adminContext = {
        ...mockContext,
        senderId: 99999, // Admin ID from config
      };

      const result = await registry.execute(toolCall, adminContext);

      expect(result.success).toBe(true);
    });

    it("should catch and return errors from executor", async () => {
      const tool = createMockTool("error_tool");
      const executor = vi.fn(async () => {
        throw new Error("Execution failed");
      });

      registry.register(tool, executor);

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "error_tool",
        arguments: { message: "test" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Execution failed");
    });

    it("should timeout long-running tools", async () => {
      vi.useFakeTimers();

      const tool = createMockTool("slow_tool");
      const executor = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100_000));
        return { success: true };
      });

      registry.register(tool, executor);

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "slow_tool",
        arguments: { message: "test" },
      };

      const resultPromise = registry.execute(toolCall, mockContext);

      await vi.advanceTimersByTimeAsync(90_000);

      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toContain("timed out");

      vi.useRealTimers();
    });
  });

  // ---------- Tool configuration ----------

  describe("loadConfigFromDB()", () => {
    it("should load configurations from database", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      // Insert directly into database
      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, updated_at, updated_by)
         VALUES (?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "admin-only");

      // Load from DB (this uses the actual loadAllToolConfigs from tool-config.ts)
      registry.loadConfigFromDB(db);

      const config = registry.getToolConfig("test_tool");
      expect(config?.enabled).toBe(false);
      expect(config?.scope).toBe("admin-only");
    });

    it("should seed missing tools with defaults", () => {
      const tool = createMockTool("new_tool");
      registry.register(tool, createMockExecutor(), "dm-only");

      // Load from DB - should seed the missing tool
      registry.loadConfigFromDB(db);

      const row = db
        .prepare("SELECT * FROM tool_config WHERE tool_name = ?")
        .get("new_tool") as any;

      expect(row).toBeDefined();
      expect(row.enabled).toBe(1);
      expect(row.scope).toBe("dm-only");
    });
  });

  describe("isToolEnabled()", () => {
    it("should return true by default when DB not loaded", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      expect(registry.isToolEnabled("test_tool")).toBe(true);
    });

    it("should return false when tool is disabled in config", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, updated_at, updated_by)
         VALUES (?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "always");

      registry.loadConfigFromDB(db);

      expect(registry.isToolEnabled("test_tool")).toBe(false);
    });
  });

  describe("setToolEnabled()", () => {
    it("should enable/disable tool and persist to DB", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());
      registry.loadConfigFromDB(db);

      const result = registry.setToolEnabled("test_tool", false, 12345);
      expect(result).toBe(true);

      const row = db
        .prepare("SELECT enabled FROM tool_config WHERE tool_name = ?")
        .get("test_tool") as any;

      expect(row.enabled).toBe(0);
      expect(registry.isToolEnabled("test_tool")).toBe(false);
    });

    it("should return false for non-existent tool", () => {
      registry.loadConfigFromDB(db);
      const result = registry.setToolEnabled("non_existent", false);
      expect(result).toBe(false);
    });

    it("should return false when DB not initialized", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      const result = registry.setToolEnabled("test_tool", false);
      expect(result).toBe(false);
    });
  });

  describe("updateToolScope()", () => {
    it("should update tool scope and persist to DB", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "always");
      registry.loadConfigFromDB(db);

      const result = registry.updateToolScope("test_tool", "admin-only", 12345);
      expect(result).toBe(true);

      const config = registry.getToolConfig("test_tool");
      expect(config?.scope).toBe("admin-only");
    });

    it("should return false for non-existent tool", () => {
      registry.loadConfigFromDB(db);
      const result = registry.updateToolScope("non_existent", "admin-only");
      expect(result).toBe(false);
    });
  });

  describe("getToolConfig()", () => {
    it("should return null for non-existent tool", () => {
      expect(registry.getToolConfig("non_existent")).toBeNull();
    });

    it("should return default config when DB not loaded", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "dm-only");

      const config = registry.getToolConfig("test_tool");
      expect(config).toEqual({
        enabled: true,
        scope: "dm-only",
      });
    });

    it("should return DB config when available", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "always");

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, updated_at, updated_by)
         VALUES (?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "admin-only");

      registry.loadConfigFromDB(db);

      const config = registry.getToolConfig("test_tool");
      expect(config?.enabled).toBe(false);
      expect(config?.scope).toBe("admin-only");
    });
  });

  // ---------- Plugin tools ----------

  describe("isPluginModule()", () => {
    it("should return false for non-plugin module", () => {
      expect(registry.isPluginModule("telegram")).toBe(false);
    });

    it("should return true for plugin module", () => {
      const tools = [
        {
          tool: createMockTool("casino_spin"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.registerPluginTools("casino", tools);
      expect(registry.isPluginModule("casino")).toBe(true);
    });
  });

  describe("registerPluginTools()", () => {
    it("should register multiple plugin tools", () => {
      const tools = [
        {
          tool: createMockTool("plugin_tool1"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
        {
          tool: createMockTool("plugin_tool2"),
          executor: createMockExecutor(),
          scope: "dm-only" as ToolScope,
        },
      ];

      const count = registry.registerPluginTools("test-plugin", tools);

      expect(count).toBe(2);
      expect(registry.has("plugin_tool1")).toBe(true);
      expect(registry.has("plugin_tool2")).toBe(true);
      expect(registry.isPluginModule("test-plugin")).toBe(true);
    });

    it("should skip duplicate tool names", () => {
      const tool = createMockTool("duplicate_tool");
      registry.register(tool, createMockExecutor());

      const pluginTools = [
        {
          tool,
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      const count = registry.registerPluginTools("test-plugin", pluginTools);
      expect(count).toBe(0);
    });

    it("should set module name to plugin name", () => {
      const tools = [
        {
          tool: createMockTool("casino_spin"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.registerPluginTools("casino", tools);

      const moduleTools = registry.getModuleTools("casino");
      expect(moduleTools).toHaveLength(1);
      expect(moduleTools[0].name).toBe("casino_spin");
    });
  });

  describe("replacePluginTools()", () => {
    it("should replace plugin tools atomically", () => {
      const oldTools = [
        {
          tool: createMockTool("plugin_old1"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
        {
          tool: createMockTool("plugin_old2"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.registerPluginTools("test-plugin", oldTools);

      const newTools = [
        {
          tool: createMockTool("plugin_new1"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.replacePluginTools("test-plugin", newTools);

      expect(registry.has("plugin_old1")).toBe(false);
      expect(registry.has("plugin_old2")).toBe(false);
      expect(registry.has("plugin_new1")).toBe(true);
    });

    it("should not overwrite core tools", () => {
      const coreTool = createMockTool("telegram_send");
      registry.register(coreTool, createMockExecutor());

      const pluginTools = [
        {
          tool: createMockTool("telegram_send"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.replacePluginTools("test-plugin", pluginTools);

      // Core tool should still be there, plugin tool skipped
      expect(registry.has("telegram_send")).toBe(true);
      expect(registry.getModuleToolCount("telegram")).toBe(1);
    });

    it("should allow re-registering previously owned tools", () => {
      const oldTools = [
        {
          tool: createMockTool("plugin_tool"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.registerPluginTools("test-plugin", oldTools);

      const newTools = [
        {
          tool: createMockTool("plugin_tool"),
          executor: createMockExecutor(),
          scope: "dm-only" as ToolScope,
        },
      ];

      registry.replacePluginTools("test-plugin", newTools);

      expect(registry.has("plugin_tool")).toBe(true);
      const moduleTools = registry.getModuleTools("test-plugin");
      expect(moduleTools[0].scope).toBe("dm-only");
    });
  });

  describe("removePluginTools()", () => {
    it("should remove all plugin tools", () => {
      const tools = [
        {
          tool: createMockTool("plugin_tool1"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
        {
          tool: createMockTool("plugin_tool2"),
          executor: createMockExecutor(),
          scope: "always" as ToolScope,
        },
      ];

      registry.registerPluginTools("test-plugin", tools);
      expect(registry.count).toBe(2);

      registry.removePluginTools("test-plugin");

      expect(registry.count).toBe(0);
      expect(registry.has("plugin_tool1")).toBe(false);
      expect(registry.has("plugin_tool2")).toBe(false);
      expect(registry.isPluginModule("test-plugin")).toBe(false);
    });

    it("should handle removing non-existent plugin", () => {
      expect(() => {
        registry.removePluginTools("non-existent");
      }).not.toThrow();
    });
  });

  // ---------- Edge cases ----------

  describe("edge cases", () => {
    it("should handle empty registry gracefully", () => {
      expect(registry.count).toBe(0);
      expect(registry.getAll()).toEqual([]);
      expect(registry.getAvailableModules()).toEqual([]);
      expect(registry.getForContext(false, null)).toEqual([]);
    });

    it("should handle tool names with multiple underscores", () => {
      const tool = createMockTool("complex_module_name_tool");
      registry.register(tool, createMockExecutor());

      const modules = registry.getAvailableModules();
      expect(modules).toContain("complex");
    });

    it("should handle execution when disabled tools are filtered", async () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, updated_at, updated_by)
         VALUES (?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "always");

      registry.loadConfigFromDB(db);

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "test_tool",
        arguments: { message: "test" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("currently disabled");
    });

    it("should exclude disabled tools from getForContext", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, updated_at, updated_by)
         VALUES (?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "always");

      registry.loadConfigFromDB(db);

      const tools = registry.getForContext(false, null);
      expect(tools).toHaveLength(0);
    });
  });
});
