import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { ToolRegistry } from "../registry.js";
import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolContext, ToolScope } from "../types.js";
import type { ToolCall } from "@earendil-works/pi-ai";

// Mock modules
vi.mock("@earendil-works/pi-ai", () => ({
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

    // Create tool_config table for database tests (post-1.19 shape).
    db.exec(`
      CREATE TABLE IF NOT EXISTS tool_config (
        tool_name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1,
        scope TEXT,
        scope_level TEXT NOT NULL DEFAULT 'all',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_by INTEGER
      )
    `);

    mockContext = {
      bridge: { getMode: () => "user" } as any,
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

    it("should return tools with derived scope", () => {
      registry.register(createMockTool("telegram_send"), createMockExecutor(), "open");
      registry.register(createMockTool("telegram_wallet"), createMockExecutor(), "admin-only");
      registry.register(createMockTool("telegram_kick"), createMockExecutor(), "allowlist");

      const tools = registry.getModuleTools("telegram");
      expect(tools).toHaveLength(3);
      expect(tools).toEqual([
        { name: "telegram_kick", scope: "allowlist" },
        { name: "telegram_send", scope: "open" },
        { name: "telegram_wallet", scope: "admin-only" },
      ]);
    });
  });

  // ---------- Access-level filtering ----------

  describe("getForContext()", () => {
    beforeEach(() => {
      registry.register(createMockTool("open_tool"), createMockExecutor(), "open");
      registry.register(createMockTool("admin_only_tool"), createMockExecutor(), "admin-only");
      registry.register(createMockTool("disabled_tool"), createMockExecutor(), "disabled");
    });

    it("should exclude admin-only tools for non-admin users", () => {
      const names = registry.getForContext(false, null, undefined, false).map((t) => t.name);

      expect(names).toContain("open_tool");
      expect(names).not.toContain("admin_only_tool");
      expect(names).not.toContain("disabled_tool");
    });

    it("should include admin-only tools for admin users", () => {
      const names = registry.getForContext(false, null, undefined, true).map((t) => t.name);

      expect(names).toContain("admin_only_tool");
      expect(names).not.toContain("disabled_tool");
    });

    it("should apply the same access regardless of DM vs group context", () => {
      const dm = registry
        .getForContext(false, null, undefined, true)
        .map((t) => t.name)
        .sort();
      const group = registry
        .getForContext(true, null, undefined, true)
        .map((t) => t.name)
        .sort();
      expect(dm).toEqual(group);
    });

    it("should truncate to tool limit when exceeded", () => {
      const tools = registry.getForContext(false, 1, undefined, true);
      expect(tools.length).toBe(1);
    });
  });

  describe("channel scope (dm-only / group-only)", () => {
    beforeEach(() => {
      registry.register(createMockTool("dm_tool"), createMockExecutor(), "dm-only");
      registry.register(createMockTool("group_tool"), createMockExecutor(), "group-only");
    });

    it("excludes dm-only tools in groups and group-only tools in DMs", () => {
      const dm = registry.getForContext(false, null, undefined, true).map((t) => t.name);
      expect(dm).toContain("dm_tool");
      expect(dm).not.toContain("group_tool");

      const group = registry.getForContext(true, null, undefined, true).map((t) => t.name);
      expect(group).toContain("group_tool");
      expect(group).not.toContain("dm_tool");
    });

    it("denies executing a dm-only tool in a group", async () => {
      const result = await registry.execute({ name: "dm_tool", input: { message: "x" } } as any, {
        ...mockContext,
        isGroup: true,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/direct message/i);
    });

    it("allows executing a dm-only tool in a DM", async () => {
      const result = await registry.execute({ name: "dm_tool", input: { message: "x" } } as any, {
        ...mockContext,
        isGroup: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("minimum access floor", () => {
    it("does not let a persisted all-level override weaken an admin floor", () => {
      const tool = createMockTool("wallet_action", "action");
      registry.register(tool, createMockExecutor(), "dm-only", "both", [], "admin");

      db.prepare(
        `INSERT INTO tool_config
          (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, 1, 'open', 'all', unixepoch(), NULL)`
      ).run(tool.name);
      registry.loadConfigFromDB(db);

      expect(registry.getToolConfig(tool.name)).toEqual({ level: "admin" });
      expect(registry.getForContext(false, null, undefined, false, 12345)).toEqual([]);
      expect(registry.getForContext(false, null, undefined, true, 99999)).toContainEqual(tool);
    });

    it("clamps runtime updates below the declared minimum", () => {
      const tool = createMockTool("private_data", "data-bearing");
      registry.register(tool, createMockExecutor(), "open", "both", [], "admin");
      registry.loadConfigFromDB(db);

      expect(registry.updateToolLevel(tool.name, "all")).toBe(true);
      expect(registry.getToolConfig(tool.name)).toEqual({ level: "admin" });
      expect(
        db.prepare("SELECT scope_level FROM tool_config WHERE tool_name = ?").get(tool.name)
      ).toEqual({ scope_level: "admin" });
    });
  });

  describe("tool-specific allowlist", () => {
    it("uses a tool-specific allowlist instead of the global Telegram allowlist", async () => {
      const tool = createMockTool("exec_run", "action");
      registry.setAllowFrom([222]);
      registry.register(
        tool,
        createMockExecutor(),
        "allowlist",
        "both",
        [],
        "allowlist",
        false,
        [111]
      );

      expect(registry.getForContext(false, null, "dm", false, 111)).toContainEqual(tool);
      expect(registry.getForContext(false, null, "dm", false, 222)).not.toContainEqual(tool);

      const denied = await registry.execute(
        { type: "toolCall", id: "exec-denied", name: tool.name, arguments: { message: "x" } },
        { ...mockContext, senderId: 222 }
      );
      expect(denied).toMatchObject({
        success: false,
        error: expect.stringMatching(/allowed users/),
      });
    });
  });

  // ---------- Tool execution ----------

  describe("execute()", () => {
    it("should defer approval-required tools without calling their executor", async () => {
      const tool = createMockTool("financial_tool", "action");
      const executor = createMockExecutor({ success: true });
      const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
      mockContext.bridge = { getMode: () => "user", sendMessage } as any;
      mockContext.senderId = 99999;

      registry.register(tool, executor, "admin-only", "both", [], "admin", true);

      const result = await registry.execute(
        {
          type: "toolCall",
          id: "call-approval",
          name: tool.name,
          arguments: { message: "send exactly 1 TON" },
        },
        mockContext
      );

      expect(result).toMatchObject({
        success: false,
        data: { approvalRequired: true },
      });
      expect(result.error).toContain("owner approval");
      expect(executor).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledOnce();
      expect(sendMessage.mock.calls[0][0].text).toContain("send exactly 1 TON");
      expect(sendMessage.mock.calls[0][0].text).toMatch(/\/approve [a-f0-9-]+/);
      expect(JSON.stringify(result)).not.toMatch(/\/approve [a-f0-9-]+/);
    });

    it("should execute an approved request once for the same admin and chat", async () => {
      const tool = createMockTool("financial_tool", "action");
      const executor = createMockExecutor({ success: true, data: { tx: "abc" } });
      const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
      mockContext.bridge = { getMode: () => "user", sendMessage } as any;
      mockContext.senderId = 99999;

      registry.register(tool, executor, "admin-only", "both", [], "admin", true);
      await registry.execute(
        {
          type: "toolCall",
          id: "call-approval",
          name: tool.name,
          arguments: { message: "send exactly 1 TON" },
        },
        mockContext
      );
      const approvalId = sendMessage.mock.calls[0][0].text.match(/\/approve ([a-f0-9-]+)/)?.[1];
      expect(approvalId).toBeTruthy();

      await expect(
        registry.approvePendingAction(approvalId!, 11111, "test-chat")
      ).resolves.toMatchObject({ success: false });
      await expect(
        registry.approvePendingAction(approvalId!, 99999, "wrong-chat")
      ).resolves.toMatchObject({ success: false });
      expect(executor).not.toHaveBeenCalled();

      await expect(registry.approvePendingAction(approvalId!, 99999, "test-chat")).resolves.toEqual(
        { success: true, data: { tx: "abc" } }
      );
      expect(executor).toHaveBeenCalledOnce();
      expect(executor).toHaveBeenCalledWith({ message: "send exactly 1 TON" }, mockContext);

      await expect(
        registry.approvePendingAction(approvalId!, 99999, "test-chat")
      ).resolves.toMatchObject({ success: false });
      expect(executor).toHaveBeenCalledOnce();
    });

    it("should reject a pending approval without executing it", async () => {
      const tool = createMockTool("financial_tool", "action");
      const executor = createMockExecutor({ success: true });
      const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
      mockContext.bridge = { getMode: () => "user", sendMessage } as any;
      mockContext.senderId = 99999;

      registry.register(tool, executor, "admin-only", "both", [], "admin", true);
      await registry.execute(
        {
          type: "toolCall",
          id: "call-approval",
          name: tool.name,
          arguments: { message: "send exactly 1 TON" },
        },
        mockContext
      );
      const approvalId = sendMessage.mock.calls[0][0].text.match(/\/approve ([a-f0-9-]+)/)?.[1];

      await expect(
        registry.rejectPendingAction(approvalId!, 99999, "test-chat")
      ).resolves.toMatchObject({ success: true });
      await expect(
        registry.approvePendingAction(approvalId!, 99999, "test-chat")
      ).resolves.toMatchObject({ success: false });
      expect(executor).not.toHaveBeenCalled();
    });

    it("should fail closed for self-originated autonomous financial actions", async () => {
      const tool = createMockTool("financial_tool", "action");
      const executor = createMockExecutor({ success: true });
      const sendMessage = vi.fn();
      mockContext.bridge = {
        getMode: () => "user",
        getOwnUserId: () => 99999n,
        sendMessage,
      } as any;
      mockContext.senderId = 99999;

      registry.register(tool, executor, "admin-only", "both", [], "admin", true);
      const result = await registry.execute(
        {
          type: "toolCall",
          id: "call-self-approval",
          name: tool.name,
          arguments: { message: "send exactly 1 TON" },
        },
        mockContext
      );

      expect(result).toMatchObject({ success: false });
      expect(result.error).toContain("interactive admin request");
      expect(sendMessage).not.toHaveBeenCalled();
      expect(executor).not.toHaveBeenCalled();
    });

    it("should expire pending approvals after five minutes", async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-07-09T00:00:00Z"));
        const tool = createMockTool("financial_tool", "action");
        const executor = createMockExecutor({ success: true });
        const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
        mockContext.bridge = { getMode: () => "user", sendMessage } as any;
        mockContext.senderId = 99999;

        registry.register(tool, executor, "admin-only", "both", [], "admin", true);
        await registry.execute(
          {
            type: "toolCall",
            id: "call-expiring-approval",
            name: tool.name,
            arguments: { message: "send exactly 1 TON" },
          },
          mockContext
        );
        const approvalId = sendMessage.mock.calls[0][0].text.match(/\/approve ([a-f0-9-]+)/)?.[1];

        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);

        await expect(
          registry.approvePendingAction(approvalId!, 99999, "test-chat")
        ).resolves.toMatchObject({ success: false });
        expect(executor).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

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

    it("should deny a disabled tool", async () => {
      const tool = createMockTool("off_tool");
      registry.register(tool, createMockExecutor(), "disabled");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "off_tool",
        arguments: { message: "test" },
      };

      const result = await registry.execute(toolCall, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain("currently disabled");
    });

    it("should allow an open tool regardless of context", async () => {
      const tool = createMockTool("open_tool");
      registry.register(tool, createMockExecutor({ success: true }), "open");

      const toolCall: ToolCall = {
        type: "toolCall",
        id: "call-1",
        name: "open_tool",
        arguments: { message: "test" },
      };

      const groupContext = { ...mockContext, isGroup: true };
      const result = await registry.execute(toolCall, groupContext);

      expect(result.success).toBe(true);
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

    it("should timeout long-running data-bearing tools", async () => {
      vi.useFakeTimers();

      const tool = createMockTool("slow_tool", "data-bearing");
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

    it("should not report an action timeout while its side effect is still running", async () => {
      vi.useFakeTimers();
      try {
        let sideEffectCompleted = false;
        let resultSettled = false;
        const tool = createMockTool("slow_action", "action");
        const executor = vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100_000));
          sideEffectCompleted = true;
          return { success: true };
        });
        registry.register(tool, executor);

        const resultPromise = registry.execute(
          {
            type: "toolCall",
            id: "slow-action-call",
            name: tool.name,
            arguments: { message: "perform once" },
          },
          mockContext
        );
        void resultPromise.then(() => {
          resultSettled = true;
        });

        await vi.advanceTimersByTimeAsync(90_000);

        expect(resultSettled).toBe(false);
        expect(sideEffectCompleted).toBe(false);

        await vi.advanceTimersByTimeAsync(10_000);
        await expect(resultPromise).resolves.toEqual({ success: true });
        expect(sideEffectCompleted).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // ---------- Tool configuration ----------

  describe("loadConfigFromDB()", () => {
    it("should load configurations from database", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      // Insert directly into database (scope_level is the source of truth).
      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 1, "admin-only", "admin");

      // Load from DB (this uses the actual loadAllToolConfigs from tool-config.ts)
      registry.loadConfigFromDB(db);

      const config = registry.getToolConfig("test_tool");
      expect(config).toEqual({ level: "admin" });
    });

    it("should seed missing tools with defaults", () => {
      const tool = createMockTool("new_tool");
      registry.register(tool, createMockExecutor(), "admin-only");

      // Load from DB - should seed the missing tool
      registry.loadConfigFromDB(db);

      const row = db
        .prepare("SELECT * FROM tool_config WHERE tool_name = ?")
        .get("new_tool") as any;

      expect(row).toBeDefined();
      expect(row.scope_level).toBe("admin");
    });
  });

  describe("isToolEnabled()", () => {
    it("should return true by default when DB not loaded", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      expect(registry.isToolEnabled("test_tool")).toBe(true);
    });

    it("should return false when tool level is off", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "disabled", "off");

      registry.loadConfigFromDB(db);

      expect(registry.isToolEnabled("test_tool")).toBe(false);
    });
  });

  describe("setToolEnabled()", () => {
    it("should disable tool (level off) and persist to DB", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());
      registry.loadConfigFromDB(db);

      const result = registry.setToolEnabled("test_tool", false, 12345);
      expect(result).toBe(true);

      const row = db
        .prepare("SELECT scope_level FROM tool_config WHERE tool_name = ?")
        .get("test_tool") as any;

      expect(row.scope_level).toBe("off");
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

  describe("updateToolLevel()", () => {
    it("should update the access level and persist to DB", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());
      registry.loadConfigFromDB(db);

      const result = registry.updateToolLevel("test_tool", "admin", 12345);
      expect(result).toBe(true);

      expect(registry.getToolConfig("test_tool")).toEqual({ level: "admin" });
    });

    it("should return false for non-existent tool", () => {
      registry.loadConfigFromDB(db);
      const result = registry.updateToolLevel("non_existent", "admin");
      expect(result).toBe(false);
    });
  });

  describe("updateToolScope() (legacy adapter)", () => {
    it("should map a legacy scope onto a level", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "always");
      registry.loadConfigFromDB(db);

      const result = registry.updateToolScope("test_tool", "admin-only", 12345);
      expect(result).toBe(true);

      expect(registry.getToolConfig("test_tool")).toEqual({ level: "admin" });
    });
  });

  describe("getToolConfig()", () => {
    it("should return null for non-existent tool", () => {
      expect(registry.getToolConfig("non_existent")).toBeNull();
    });

    it("should return default level when DB not loaded", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "admin-only");

      const config = registry.getToolConfig("test_tool");
      expect(config).toEqual({ level: "admin" });
    });

    it("should return DB config when available", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor(), "always");

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 1, "admin-only", "admin");

      registry.loadConfigFromDB(db);

      const config = registry.getToolConfig("test_tool");
      expect(config).toEqual({ level: "admin" });
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
    it("defaults external action tools to admin-only approval", () => {
      const action = createMockTool("plugin_mutate", "action");

      registry.registerPluginTools("test-plugin", [
        { tool: action, executor: createMockExecutor() },
      ]);

      expect(registry.getToolConfig(action.name)).toEqual({ level: "admin" });
      expect(registry.getForContext(false, null, "dm", false, 12345)).not.toContainEqual(action);

      registry.setAllowFrom([12345]);
      expect(registry.getForContext(false, null, "dm", false, 12345)).not.toContainEqual(action);
      expect(registry.getForContext(false, null, "dm", true, 99999)).toContainEqual(action);
    });

    it("keeps external data-bearing tools public by default", () => {
      const readOnly = createMockTool("plugin_lookup", "data-bearing");

      registry.registerPluginTools("test-plugin", [
        { tool: readOnly, executor: createMockExecutor() },
      ]);

      expect(registry.getToolConfig(readOnly.name)).toEqual({ level: "all" });
      expect(registry.getForContext(false, null, "dm", false, 12345)).toContainEqual(readOnly);
    });

    it("requires owner approval for every external action", async () => {
      const action = createMockTool("plugin_mutate", "action");
      const executor = createMockExecutor();
      const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
      registry.setAllowFrom([99999]);
      registry.registerPluginTools("test-plugin", [{ tool: action, executor }]);

      const result = await registry.execute(
        {
          type: "toolCall",
          id: "plugin-approval",
          name: action.name,
          arguments: { message: "mutate" },
        },
        {
          ...mockContext,
          senderId: 99999,
          bridge: { getMode: () => "user", sendMessage } as never,
        }
      );

      expect(result).toMatchObject({
        success: false,
        data: { approvalRequired: true },
      });
      expect(executor).not.toHaveBeenCalled();
      expect(sendMessage).toHaveBeenCalledOnce();
    });

    it("allows a data-bearing external tool to opt into approval", async () => {
      const readOnly = createMockTool("plugin_private_lookup", "data-bearing");
      const executor = createMockExecutor();
      const sendMessage = vi.fn(async () => ({ id: 1, date: 1, chatId: "test-chat" }));
      registry.registerPluginTools("test-plugin", [
        { tool: readOnly, executor, requiresApproval: true },
      ]);

      const result = await registry.execute(
        {
          type: "toolCall",
          id: "plugin-read-approval",
          name: readOnly.name,
          arguments: { message: "read" },
        },
        {
          ...mockContext,
          senderId: 99999,
          bridge: { getMode: () => "user", sendMessage } as never,
        }
      );

      expect(result).toMatchObject({ data: { approvalRequired: true } });
      expect(executor).not.toHaveBeenCalled();
    });

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
          scope: "admin-only" as ToolScope,
        },
      ];

      registry.replacePluginTools("test-plugin", newTools);

      expect(registry.has("plugin_tool")).toBe(true);
      const moduleTools = registry.getModuleTools("test-plugin");
      expect(moduleTools[0].scope).toBe("admin-only");
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

    it("should handle execution when off tools are filtered", async () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "disabled", "off");

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

    it("should exclude off tools from getForContext", () => {
      const tool = createMockTool("test_tool");
      registry.register(tool, createMockExecutor());

      db.prepare(
        `INSERT INTO tool_config (tool_name, enabled, scope, scope_level, updated_at, updated_by)
         VALUES (?, ?, ?, ?, unixepoch(), NULL)`
      ).run("test_tool", 0, "disabled", "off");

      registry.loadConfigFromDB(db);

      const tools = registry.getForContext(false, null);
      expect(tools).toHaveLength(0);
    });
  });
});
