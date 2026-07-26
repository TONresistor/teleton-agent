import { describe, expect, it, vi } from "vitest";
import type { PluginModule, PluginContext } from "../../agent/tools/types.js";
import type { PluginModuleWithHooks } from "../../agent/tools/plugin-loader.js";
import type { GramJSUserBridge } from "../../telegram/bridges/user.js";
import { createUserPluginCallbackHandler, dispatchPluginMessage } from "../plugin-events.js";
import { startPluginModules, stopPluginModules } from "../plugin-lifecycle.js";

function module(
  name: string,
  overrides: Partial<PluginModuleWithHooks> = {}
): PluginModuleWithHooks {
  return {
    name,
    version: "1.0.0",
    tools: () => [],
    ...overrides,
  };
}

describe("application plugin boundaries", () => {
  it("rolls back started plugins when a later plugin fails", async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const first = module("first", { start: vi.fn().mockResolvedValue(undefined), stop });
    const second = module("second", { start: vi.fn().mockRejectedValue(new Error("boom")) });

    await expect(startPluginModules([first, second], {} as PluginContext)).rejects.toThrow("boom");
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops every plugin even when one stop hook fails", async () => {
    const afterFailure = vi.fn().mockResolvedValue(undefined);
    await stopPluginModules([
      module("broken", { stop: vi.fn().mockRejectedValue(new Error("boom")) }),
      module("healthy", { stop: afterFailure }),
    ]);
    expect(afterFailure).toHaveBeenCalledOnce();
  });

  it("isolates message hook failures and continues dispatching", async () => {
    const healthy = vi.fn().mockResolvedValue(undefined);
    await dispatchPluginMessage(
      [
        module("broken", { onMessage: vi.fn().mockRejectedValue(new Error("boom")) }),
        module("healthy", { onMessage: healthy }),
      ],
      { chatId: "1", senderId: 2, text: "hello", isGroup: false }
    );
    expect(healthy).toHaveBeenCalledOnce();
  });

  it("converts GramJS callback updates to the stable plugin event", async () => {
    const answerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    const bridge = {
      getClient: () => ({ answerCallbackQuery }),
    } as unknown as GramJSUserBridge;
    const onCallback = vi.fn().mockResolvedValue(undefined);
    const handler = createUserPluginCallbackHandler(bridge, onCallback);

    await handler({
      queryId: "query-1",
      data: "approve:42:fast",
      peer: { channelId: { toString: () => "-1001" } },
      msgId: 7,
      userId: 9,
    });

    expect(onCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        data: "approve:42:fast",
        action: "approve",
        params: ["42", "fast"],
        chatId: "-1001",
        messageId: 7,
        userId: 9,
      })
    );
    const event = onCallback.mock.calls[0][0];
    await event.answer("done", true);
    expect(answerCallbackQuery).toHaveBeenCalledWith("query-1", {
      message: "done",
      alert: true,
    });
  });
});
