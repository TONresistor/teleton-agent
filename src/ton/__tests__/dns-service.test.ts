import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Cell } from "@ton/core";

const addresses = {
  owner: `0:${"11".repeat(32)}`,
  nft: `0:${"22".repeat(32)}`,
  target: `0:${"33".repeat(32)}`,
  stranger: `0:${"44".repeat(32)}`,
};

const mocks = vi.hoisted(() => ({
  tonapiFetch: vi.fn(),
  loadWallet: vi.fn(),
  getCachedTonClient: vi.fn(),
  openWallet: vi.fn(),
  sendWalletTx: vi.fn(),
  withTxLock: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));

vi.mock("../../constants/api-endpoints.js", () => ({ tonapiFetch: mocks.tonapiFetch }));
vi.mock("../wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getCachedTonClient: mocks.getCachedTonClient,
}));
vi.mock("../wallet-open.js", () => ({ openWallet: mocks.openWallet }));
vi.mock("../confirm.js", () => ({ sendWalletTx: mocks.sendWalletTx }));
vi.mock("../tx-lock.js", () => ({ withTxLock: mocks.withTxLock }));

import {
  DnsUpdateError,
  linkDnsWallet,
  normalizeAdnlAddress,
  normalizeTonDomain,
  setDnsSite,
  unlinkDnsWallet,
} from "../dns-service.js";

function successfulDnsResponse(owner = addresses.owner): Response {
  return new Response(
    JSON.stringify({
      item: { address: addresses.nft, owner: { address: owner } },
    }),
    { status: 200 }
  );
}

function sentBody(): Cell {
  const options = mocks.sendWalletTx.mock.calls.at(-1)?.[2];
  return options.messages[0].body as Cell;
}

describe("DNS mutation service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadWallet.mockReturnValue({ address: addresses.owner });
    mocks.tonapiFetch.mockImplementation(async () => successfulDnsResponse());
    mocks.getCachedTonClient.mockResolvedValue({ id: "client" });
    mocks.openWallet.mockResolvedValue({
      keyPair: { secretKey: Buffer.alloc(64) },
      contract: { id: "wallet" },
    });
    mocks.sendWalletTx.mockResolvedValue({ hash: "abc123", seqno: 7, at: 1 });
  });

  it("normalizes public DNS inputs consistently", () => {
    expect(normalizeTonDomain("  Example.TON ")).toBe("example.ton");
    expect(() => normalizeTonDomain("  ")).toThrow("Domain must not be empty");
    expect(normalizeAdnlAddress(`0x${"AB".repeat(32)}`)).toBe("ab".repeat(32));
    expect(() => normalizeAdnlAddress("invalid")).toThrow(DnsUpdateError);
  });

  it("rejects a mutation when the configured wallet does not own the DNS NFT", async () => {
    mocks.tonapiFetch.mockResolvedValue(successfulDnsResponse(addresses.stranger));

    await expect(unlinkDnsWallet("example")).rejects.toMatchObject({ code: "NOT_OWNER" });
    expect(mocks.openWallet).not.toHaveBeenCalled();
    expect(mocks.sendWalletTx).not.toHaveBeenCalled();
  });

  it("builds wallet link and unlink records through the same confirmed transaction path", async () => {
    const linked = await linkDnsWallet("Example.TON", addresses.target);
    expect(linked).toMatchObject({
      domain: "example.ton",
      nftAddress: addresses.nft,
      from: addresses.owner,
      tx: { hash: "abc123" },
    });
    expect(mocks.tonapiFetch).toHaveBeenCalledWith("/dns/example.ton");

    const linkBody = sentBody().beginParse();
    expect(linkBody.loadUint(32)).toBe(0x4eb1f0f9);
    expect(linkBody.loadUintBig(64)).toBe(0n);
    expect(linkBody.loadUintBig(256)).toBe(
      0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1bn
    );
    const walletRecord = linkBody.loadRef().beginParse();
    expect(walletRecord.loadUint(16)).toBe(0x9fd3);
    expect(walletRecord.loadAddress().toRawString()).toBe(addresses.target);
    expect(walletRecord.loadUint(8)).toBe(0);

    await unlinkDnsWallet("example");
    const unlinkBody = sentBody().beginParse();
    unlinkBody.skip(32 + 64 + 256);
    expect(unlinkBody.remainingRefs).toBe(0);
    expect(mocks.withTxLock).toHaveBeenCalledTimes(2);
  });

  it("builds a canonical ADNL site record", async () => {
    const adnl = "ab".repeat(32);
    await setDnsSite("example", adnl);

    const body = sentBody().beginParse();
    body.skip(32 + 64);
    expect(body.loadUintBig(256)).toBe(
      0xfbae041b02c41ed0fd8a4efb039bc780dd6af4a1f0c420f42561ae705dda43fen
    );
    const record = body.loadRef().beginParse();
    expect(record.loadUint(16)).toBe(0xad01);
    expect(record.loadBuffer(32).toString("hex")).toBe(adnl);
    expect(record.loadUint(8)).toBe(0);
  });
});
