import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHighloadSDK, HighloadQueryIdSequence } from "../ton-highload.js";

const mocks = vi.hoisted(() => ({
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
  withTxLock: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("../../ton/wallet-service.js", () => ({
  getKeyPair: mocks.getKeyPair,
  getCachedTonClient: mocks.getCachedTonClient,
}));
vi.mock("../../ton/tx-lock.js", () => ({ withTxLock: mocks.withTxLock }));

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const recipient = `0:${"2".repeat(64)}`;

describe("HighloadQueryIdSequence", () => {
  it("restores and advances persisted query IDs", () => {
    const sequence = HighloadQueryIdSequence.restore(1022);
    expect(sequence.current()).toBe(1022);
    expect(sequence.next()).toBe(1024);
    expect(HighloadQueryIdSequence.restore(sequence.current()).current()).toBe(1024);
  });
});

describe("createHighloadSDK", () => {
  let db: Database.Database;
  let coreDb: Database.Database;
  let opened: {
    sendBatch: ReturnType<typeof vi.fn>;
    getTimeout: ReturnType<typeof vi.fn>;
    getLastCleaned: ReturnType<typeof vi.fn>;
    getSubwalletId: ReturnType<typeof vi.fn>;
  };
  let client: {
    getBalance: ReturnType<typeof vi.fn>;
    getContractState: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    coreDb = new Database(":memory:");
    opened = {
      sendBatch: vi.fn().mockResolvedValue(undefined),
      getTimeout: vi.fn().mockResolvedValue(86400),
      getLastCleaned: vi.fn().mockResolvedValue(1234),
      getSubwalletId: vi.fn().mockResolvedValue(0x10ad),
    };
    client = {
      getBalance: vi.fn().mockResolvedValue(2_000_000_000n),
      getContractState: vi.fn().mockResolvedValue({ state: "active" }),
      open: vi.fn().mockReturnValue(opened),
    };
    mocks.getKeyPair.mockResolvedValue({
      publicKey: Buffer.alloc(32, 1),
      secretKey: Buffer.alloc(64, 2),
    });
    mocks.getCachedTonClient.mockResolvedValue(client);
  });

  it("derives the legacy Highload address and reports on-chain state", async () => {
    const sdk = createHighloadSDK(log, db, vi.fn(), "multisend", coreDb);
    const info = await sdk.getInfo();

    expect(info.deployed).toBe(true);
    expect(info.balance).toBe("2");
    expect(info.currentQueryId).toBe(0);
    expect(info.timeout).toBe(86400);
    expect(info.subwalletId).toBe(0x10ad);
    expect(info.rawAddress).toBe(
      "0:1d7a481e0a8022c8ef86823d402369b0d13e1a89ef8bed63fc0dcb1738658d3e"
    );
  });

  it("shares one core sequence across isolated plugin databases", async () => {
    const sdk = createHighloadSDK(log, db, vi.fn(), "multisend", coreDb);
    const otherSdk = createHighloadSDK(
      log,
      new Database(":memory:"),
      vi.fn(),
      "other-plugin",
      coreDb
    );
    const messages = [{ to: recipient, value: 1, bounce: false }];

    const first = await sdk.sendMessages(messages);
    const second = await otherSdk.sendMessages(messages);

    expect(first.queryId).toBe(0);
    expect(second.queryId).toBe(1);
    expect(mocks.withTxLock).toHaveBeenCalledTimes(2);
    expect(opened.sendBatch.mock.calls[0][1]).toBe(0);
    expect(opened.sendBatch.mock.calls[1][1]).toBe(1);
    expect(coreDb.prepare("SELECT last_query_id FROM highload_wallet_sequence").get()).toEqual({
      last_query_id: "2",
    });
  });

  it("encodes the same external message as the legacy Highload v3 implementation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    try {
      let externalCell: { hash(): Buffer } | undefined;
      client.open.mockImplementation((contract: unknown) => {
        const contractWithSend = contract as {
          sendBatch(provider: unknown, ...args: unknown[]): Promise<void>;
        };
        return {
          ...opened,
          sendBatch: (...args: unknown[]) =>
            contractWithSend.sendBatch(
              {
                external: async (cell: { hash(): Buffer }) => {
                  externalCell = cell;
                },
              },
              ...args
            ),
        };
      });
      const sdk = createHighloadSDK(log, db, vi.fn(), "multisend", coreDb);

      await sdk.sendMessages([{ to: recipient, value: 1, bounce: false }]);

      expect(externalCell?.hash().toString("hex")).toBe(
        "2f9adc0320d6e5a57d6438bc230475916a0013a4addb027dc0af8ad686c1f2fe"
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("funds the same derived wallet through the standard broker", async () => {
    const fund = vi.fn().mockResolvedValue({ hash: "fund-hash", seqno: 4 });
    const sdk = createHighloadSDK(log, db, fund, "multisend", coreDb);

    await expect(sdk.fund(3.5)).resolves.toEqual({ hash: "fund-hash", seqno: 4 });
    expect(fund).toHaveBeenCalledWith(expect.stringMatching(/^UQ/), 3.5, true);
  });

  it("migrates the legacy Multisend sequence into private core state", async () => {
    db.exec(`
      CREATE TABLE multisend_sequence (
        id INTEGER PRIMARY KEY,
        last_query_id TEXT NOT NULL
      )
    `);
    db.prepare("INSERT INTO multisend_sequence (id, last_query_id) VALUES (1, '42')").run();
    const sdk = createHighloadSDK(log, db, vi.fn(), "multisend", coreDb);

    await expect(sdk.getInfo()).resolves.toMatchObject({ currentQueryId: 42 });
    expect(coreDb.prepare("SELECT last_query_id FROM highload_wallet_sequence").get()).toEqual({
      last_query_id: "42",
    });

    db.prepare("UPDATE multisend_sequence SET last_query_id = '99' WHERE id = 1").run();
    await expect(sdk.getInfo()).resolves.toMatchObject({ currentQueryId: 42 });
  });
});
