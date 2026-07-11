import { describe, expect, it } from "vitest";
import { TELEGRAM_SEND_TOOLS } from "../../../constants/tools.js";
import { tools as telegramTools } from "../telegram/index.js";

describe("Telegram core tools", () => {
  function coreToolNames(): string[] {
    return telegramTools
      .filter((entry) => entry.tags?.includes("core"))
      .map((entry) => entry.tool.name);
  }

  it("does not include visible send tools in the default core set", () => {
    const coreTools = coreToolNames();

    for (const toolName of TELEGRAM_SEND_TOOLS) {
      expect(coreTools).not.toContain(toolName);
    }
  });

  it("does not include message mutation tools in the default core set", () => {
    const coreTools = coreToolNames();

    expect(coreTools).not.toContain("telegram_edit_message");
    expect(coreTools).not.toContain("telegram_delete_message");
    expect(coreTools).not.toContain("telegram_react");
  });
});
