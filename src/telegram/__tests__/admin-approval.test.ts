import { describe, expect, it, vi } from "vitest";
import { AdminHandler } from "../admin.js";

function createHandler(ownUserId?: bigint) {
  const registry = {
    approvePendingAction: vi.fn(async () => ({
      success: true,
      data: { message: "Sent 1 TON — tx abc" },
    })),
    rejectPendingAction: vi.fn(async () => ({ success: true })),
  };
  const handler = new AdminHandler(
    { getOwnUserId: () => ownUserId } as never,
    { admin_ids: [42] } as never,
    {} as never,
    "/tmp/config.yaml",
    undefined,
    registry as never
  );
  return { handler, registry };
}

describe("financial approval admin commands", () => {
  it("approves a pending action as the same admin and chat", async () => {
    const { handler, registry } = createHandler();
    const command = handler.parseCommand("/approve abc-123");

    const response = await handler.handleCommand(command!, "chat-1", 42, false);

    expect(registry.approvePendingAction).toHaveBeenCalledWith("abc-123", 42, "chat-1");
    expect(response).toContain("Sent 1 TON");
  });

  it("rejects a pending action", async () => {
    const { handler, registry } = createHandler();
    const command = handler.parseCommand("/reject abc-123");

    const response = await handler.handleCommand(command!, "chat-1", 42, false);

    expect(registry.rejectPendingAction).toHaveBeenCalledWith("abc-123", 42, "chat-1");
    expect(response).toContain("rejected");
  });

  it("never delegates approval commands from a non-admin", async () => {
    const { handler, registry } = createHandler();
    const command = handler.parseCommand("/approve abc-123");

    const response = await handler.handleCommand(command!, "chat-1", 7, false);

    expect(response).toContain("Admin access required");
    expect(registry.approvePendingAction).not.toHaveBeenCalled();
  });

  it("never accepts a self-authored approval in user mode", async () => {
    const { handler, registry } = createHandler(42n);
    const command = handler.parseCommand("/approve abc-123");

    const response = await handler.handleCommand(command!, "chat-1", 42, false);

    expect(response).toContain("separate interactive admin account");
    expect(registry.approvePendingAction).not.toHaveBeenCalled();
  });
});
