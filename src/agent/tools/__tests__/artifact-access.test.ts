import { describe, expect, it } from "vitest";
import { getBuiltinMinimumAccess } from "../security-policy.js";
import { toolResultReadTool } from "../search/tool-result-read.js";
import Database from "better-sqlite3";
import { ToolRegistry } from "../registry.js";
import { registerAllTools } from "../register-all.js";
import { ensureSchema } from "../../../memory/schema.js";
import { createToolResultArtifact } from "../../../memory/tool-result-artifacts.js";
describe("global artifact access floor", () => {
  it("requires an authorized actor even though artifacts can be read across chats", () => {
    expect(getBuiltinMinimumAccess(toolResultReadTool)).toBe("allowlist");
  });
  it("enforces the floor through actual registration and execution across chats", async () => {
    const db = new Database(":memory:");
    try {
      ensureSchema(db);
      const artifact = createToolResultArtifact(db, {
        sessionId: "private",
        chatId: "111",
        toolName: "probe",
        content: "PRIVATE_CANARY",
      });
      const registry = new ToolRegistry();
      registerAllTools(registry);
      registry.setAdminIds([111]);
      registry.setAllowFrom([222]);
      const call = {
        type: "toolCall" as const,
        id: "read",
        name: "tool_result_read",
        arguments: { artifact_id: artifact.id },
      };
      const context = { db, chatId: "999", senderId: 999, isGroup: false, bridge: {} as any };
      expect((await registry.execute(call, context)).success).toBe(false);
      const allowed = await registry.execute(call, { ...context, senderId: 222 });
      expect(allowed.success).toBe(true);
      expect(JSON.stringify(allowed)).toContain("PRIVATE_CANARY");
    } finally {
      db.close();
    }
  });
});
