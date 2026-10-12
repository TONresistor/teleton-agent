import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Api, type TelegramClient } from "telegram";
import { Type } from "@sinclair/typebox";
import { toLong } from "../../utils/gramjs-bigint.js";
const root = vi.hoisted(() => `/tmp/telegram-wallet-verification-${process.pid}`);
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: root }));
import { generateWallet, saveWallet, isTelegramWalletEnabled } from "../../ton/wallet-service.js";
import { deriveTelegramWalletKeys } from "../wallet-protocol.js";
import { TelegramWalletBootstrap } from "../wallet-bootstrap.js";
import { ToolRegistry } from "../../agent/tools/registry.js";
import type { ToolContext } from "../../agent/tools/types.js";
let controller: TelegramWalletBootstrap | undefined;
beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
});
afterEach(() => {
  controller?.stop();
  controller = undefined;
  rmSync(root, { recursive: true, force: true });
});
describe("real registry with runtime wallet verification", () => {
  it.each([true, false])(
    "requires the actual primary wallet match (matches=%s)",
    async (matches) => {
      const primary = await generateWallet();
      const seeds = deriveTelegramWalletKeys(Buffer.from(primary.mnemonic.join(" ")));
      saveWallet({
        ...primary,
        keySource: "telegram-wallet",
        mnemonic: [],
        telegramAssociation: undefined,
      });
      const keyFile = join(root, "telegram-wallet.json");
      writeFileSync(
        keyFile,
        JSON.stringify({
          scheme: "telegram-rotation",
          walletId: primary.walletId,
          anchorSeed: seeds.anchorSeed.toString("hex"),
          signingSeed: seeds.signingSeed.toString("hex"),
        }),
        { mode: 0o600 }
      );
      const original = readFileSync(keyFile, "utf8");
      let release!: (state: Api.WalletState) => void;
      const response = new Promise<Api.WalletState>((resolve) => {
        release = resolve;
      });
      const invoke = vi.fn(() => response);
      const client = {
        invoke,
        sendMessage: vi.fn(async () => ({ id: 1 })),
      } as unknown as TelegramClient;
      controller = new TelegramWalletBootstrap(client, 42);
      const registry = new ToolRegistry("user"),
        execute = vi.fn(async () => ({ success: true }));
      registry.register(
        { name: "telegram_wallet_get_state", description: "state", parameters: Type.Object({}) },
        execute,
        "admin-only",
        "user"
      );
      const context = {
        senderId: 42,
        isGroup: false,
        config: { telegram: { admin_ids: [42] } },
      } as unknown as ToolContext;
      const call = {
        type: "toolCall" as const,
        id: "check",
        name: "telegram_wallet_get_state",
        arguments: {},
      };
      const running = controller.start();
      expect(isTelegramWalletEnabled()).toBe(false);
      expect(registry.getForContext(false, null, "dm", true, 42)).toEqual([]);
      expect((await registry.execute(call, context)).success).toBe(false);
      expect(execute).not.toHaveBeenCalled();
      release(
        new Api.WalletState({
          address: primary.address,
          publicKey: Buffer.from(matches ? primary.publicKey : "00".repeat(32), "hex"),
          balance: toLong(0),
        })
      );
      await running;
      expect(isTelegramWalletEnabled()).toBe(matches);
      expect(controller.status).toBe(matches ? "ready" : "blocked");
      expect(registry.getForContext(false, null, "dm", true, 42)).toHaveLength(matches ? 1 : 0);
      expect((await registry.execute(call, context)).success).toBe(matches);
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(readFileSync(keyFile, "utf8")).toBe(original);
      controller.stop();
      expect(isTelegramWalletEnabled()).toBe(false);
      expect((await registry.execute(call, context)).success).toBe(false);
    }
  );
});
