/**
 * Highload Wallet v3 broker.
 *
 * Contract layout and message encoding follow the official
 * ton-blockchain/highload-wallet-contract-v3 reference implementation.
 * The contract code BOC is the published HighloadWalletV3 build artifact.
 */

import type Database from "better-sqlite3";
import {
  Address,
  beginCell,
  Cell,
  contractAddress,
  fromNano,
  internal,
  SendMode,
  storeMessageRelaxed,
  storeOutList,
  toNano,
  type Contract,
  type ContractProvider,
  type MessageRelaxed,
} from "@ton/core";
import { sign } from "@ton/crypto";
import type { HighloadSDK, PluginLogger, TonMessage, TonTransferResult } from "@teleton-agent/sdk";
import { PluginSDKError } from "@teleton-agent/sdk";
import { getCachedTonClient, getKeyPair } from "../ton/wallet-service.js";
import { withTxLock } from "../ton/tx-lock.js";
import { getErrorMessage } from "../utils/errors.js";
import { getDatabase } from "../memory/database.js";

const SUBWALLET_ID = 0x10ad;
const TIMEOUT = 60 * 60 * 24;
const MAX_MESSAGES = 254;
const TIMESTAMP_SIZE = 64;
const TIMEOUT_SIZE = 22;
const INTERNAL_TRANSFER_TAG = 0xae42e5a4;

// Published build from ton-blockchain/highload-wallet-contract-v3.
const HIGHLOAD_WALLET_V3_CODE_HEX =
  "b5ee9c7241021001000228000114ff00f4a413f4bcf2c80b01020120020d02014803040078d020d74bc00101c060b0915be101d0d3030171b0915be0fa4030f828c705b39130e0d31f018210ae42e5a4ba9d8040d721d74cf82a01ed55fb04e030020120050a02027306070011adce76a2686b85ffc00201200809001aabb6ed44d0810122d721d70b3f0018aa3bed44d08307d721d70b1f0201200b0c001bb9a6eed44d0810162d721d70b15800e5b8bf2eda2edfb21ab09028409b0ed44d0810120d721f404f404d33fd315d1058e1bf82325a15210b99f326df82305aa0015a112b992306dde923033e2923033e25230800df40f6fa19ed021d721d70a00955f037fdb31e09130e259800df40f6fa19cd001d721d70a00937fdb31e0915be270801f6f2d48308d718d121f900ed44d0d3ffd31ff404f404d33fd315d1f82321a15220b98e12336df82324aa00a112b9926d32de58f82301de541675f910f2a106d0d31fd4d307d30cd309d33fd315d15168baf2a2515abaf2a6f8232aa15250bcf2a304f823bbf2a35304800df40f6fa199d024d721d70a00f2649130e20e01fe5309800df40f6fa18e13d05004d718d20001f264c858cf16cf8301cf168e1030c824cf40cf8384095005a1a514cf40e2f800c94039800df41704c8cbff13cb1ff40012f40012cb3f12cb15c9ed54f80f21d0d30001f265d3020171b0925f03e0fa4001d70b01c000f2a5fa4031fa0031f401fa0031fa00318060d721d300010f0020f265d2000193d431d19130e272b1fb00b585bf03";

export class HighloadQueryIdSequence {
  static readonly BIT_NUMBER_SIZE = 10;
  static readonly BIT_NUMBER_MASK = 1023;
  static readonly MAX_BIT_NUMBER = 1022;
  static readonly MAX_SHIFT = 8191;

  constructor(
    private shift: number,
    private bitNumber: number
  ) {
    if (shift < 0 || shift > HighloadQueryIdSequence.MAX_SHIFT) {
      throw new Error("Invalid Highload query shift");
    }
    if (bitNumber < 0 || bitNumber > HighloadQueryIdSequence.MAX_BIT_NUMBER) {
      throw new Error("Invalid Highload query bit number");
    }
  }

  static restore(queryId: number): HighloadQueryIdSequence {
    return new HighloadQueryIdSequence(
      queryId >> HighloadQueryIdSequence.BIT_NUMBER_SIZE,
      queryId & HighloadQueryIdSequence.BIT_NUMBER_MASK
    );
  }

  current(): number {
    return (this.shift << HighloadQueryIdSequence.BIT_NUMBER_SIZE) | this.bitNumber;
  }

  hasNext(): boolean {
    return (
      this.shift < HighloadQueryIdSequence.MAX_SHIFT ||
      this.bitNumber < HighloadQueryIdSequence.MAX_BIT_NUMBER - 1
    );
  }

  next(): number {
    let nextShift = this.shift;
    let nextBitNumber = this.bitNumber + 1;
    if (nextBitNumber > HighloadQueryIdSequence.MAX_BIT_NUMBER) {
      nextShift += 1;
      nextBitNumber = 0;
    }
    this.shift = nextShift % HighloadQueryIdSequence.MAX_SHIFT;
    this.bitNumber = nextBitNumber;
    return this.current();
  }
}

function configToCell(publicKey: Buffer): Cell {
  return beginCell()
    .storeBuffer(publicKey)
    .storeUint(SUBWALLET_ID, 32)
    .storeDict(null)
    .storeDict(null)
    .storeUint(0, TIMESTAMP_SIZE)
    .storeUint(TIMEOUT, TIMEOUT_SIZE)
    .endCell();
}

class CoreHighloadWalletV3 implements Contract {
  readonly address: Address;
  readonly init: { code: Cell; data: Cell };

  constructor(private readonly publicKey: Buffer) {
    this.init = {
      code: Cell.fromBoc(Buffer.from(HIGHLOAD_WALLET_V3_CODE_HEX, "hex"))[0],
      data: configToCell(publicKey),
    };
    this.address = contractAddress(0, this.init);
  }

  async sendBatch(
    provider: ContractProvider,
    secretKey: Buffer,
    queryId: number,
    messages: TonMessage[],
    valuePerBatch: bigint
  ): Promise<void> {
    const actions = messages.map((message) => ({
      type: "sendMsg" as const,
      mode: SendMode.PAY_GAS_SEPARATELY,
      outMsg: internal({
        to: Address.parse(message.to),
        value: toNano(message.value.toString()),
        body: message.body,
        bounce: message.bounce ?? true,
        init: message.stateInit,
      }),
    }));
    const actionList = beginCell().store(storeOutList(actions)).endCell();
    const internalBody = beginCell()
      .storeUint(INTERNAL_TRANSFER_TAG, 32)
      .storeUint(queryId, 64)
      .storeRef(actionList)
      .endCell();
    const message: MessageRelaxed = internal({
      to: this.address,
      value: valuePerBatch,
      body: internalBody,
    });
    const mode =
      valuePerBatch > 0n ? SendMode.PAY_GAS_SEPARATELY : SendMode.CARRY_ALL_REMAINING_BALANCE;
    const signingMessage = beginCell()
      .storeUint(SUBWALLET_ID, 32)
      .storeRef(beginCell().store(storeMessageRelaxed(message)).endCell())
      .storeUint(mode, 8)
      .storeUint(queryId, 23)
      .storeUint(Math.floor(Date.now() / 1000) - 60, TIMESTAMP_SIZE)
      .storeUint(TIMEOUT, TIMEOUT_SIZE)
      .endCell();
    await provider.external(
      beginCell()
        .storeBuffer(sign(signingMessage.hash(), secretKey))
        .storeRef(signingMessage)
        .endCell()
    );
  }

  async getTimeout(provider: ContractProvider): Promise<number> {
    return (await provider.get("get_timeout", [])).stack.readNumber();
  }

  async getLastCleaned(provider: ContractProvider): Promise<number> {
    return (await provider.get("get_last_clean_time", [])).stack.readNumber();
  }

  async getSubwalletId(provider: ContractProvider): Promise<number> {
    return (await provider.get("get_subwallet_id", [])).stack.readNumber();
  }
}

function ensureSequenceTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS highload_wallet_sequence (
      address TEXT PRIMARY KEY,
      last_query_id TEXT NOT NULL,
      legacy_migrated INTEGER NOT NULL DEFAULT 0 CHECK (legacy_migrated IN (0, 1))
    )
  `);
}

function loadSequence(
  db: Database.Database,
  address: string,
  legacyDb: Database.Database | null,
  migrateLegacy: boolean
): HighloadQueryIdSequence {
  ensureSequenceTable(db);
  const row = db
    .prepare(
      "SELECT last_query_id, legacy_migrated FROM highload_wallet_sequence WHERE address = ?"
    )
    .get(address) as { last_query_id: string; legacy_migrated: number } | undefined;
  let current = row ? Number(row.last_query_id) : 0;
  let legacyMigrated = row?.legacy_migrated ?? 0;

  if (migrateLegacy && legacyMigrated === 0 && legacyDb) {
    try {
      const legacy = legacyDb
        .prepare("SELECT last_query_id FROM multisend_sequence WHERE id = 1")
        .get() as { last_query_id: string } | undefined;
      const legacyCurrent = legacy ? Number(legacy.last_query_id) : 0;
      if (Number.isInteger(legacyCurrent) && legacyCurrent > current) current = legacyCurrent;
    } catch {
      // A fresh install has no legacy sequence table.
    }
    legacyMigrated = 1;
  }

  if (!row || Number(row.last_query_id) !== current || row.legacy_migrated !== legacyMigrated) {
    db.prepare(
      "INSERT INTO highload_wallet_sequence (address, last_query_id, legacy_migrated) " +
        "VALUES (?, ?, ?) ON CONFLICT(address) DO UPDATE SET " +
        "last_query_id = excluded.last_query_id, legacy_migrated = excluded.legacy_migrated"
    ).run(address, String(current), legacyMigrated);
  }
  return HighloadQueryIdSequence.restore(current);
}

function saveSequence(
  db: Database.Database,
  address: string,
  sequence: HighloadQueryIdSequence
): void {
  db.prepare(
    "INSERT INTO highload_wallet_sequence (address, last_query_id) VALUES (?, ?) " +
      "ON CONFLICT(address) DO UPDATE SET last_query_id = excluded.last_query_id"
  ).run(address, String(sequence.current()));
}

export function createHighloadSDK(
  log: PluginLogger,
  legacyPluginDb: Database.Database | null,
  fundWallet: (address: string, amount: number, bounce: boolean) => Promise<TonTransferResult>,
  pluginName = "plugin",
  coreDbOverride?: Database.Database
): HighloadSDK {
  function stateDb(): Database.Database {
    return coreDbOverride ?? getDatabase().getDb();
  }

  async function context() {
    const keyPair = await getKeyPair();
    if (!keyPair) {
      throw new PluginSDKError("Wallet not initialized", "WALLET_NOT_INITIALIZED");
    }
    const wallet = new CoreHighloadWalletV3(keyPair.publicKey);
    const client = await getCachedTonClient();
    return { keyPair, wallet, client };
  }

  return {
    async getInfo() {
      const { wallet, client } = await context();
      const sequence = loadSequence(
        stateDb(),
        wallet.address.toRawString(),
        legacyPluginDb,
        pluginName === "multisend"
      );
      try {
        const [balance, state] = await Promise.all([
          client.getBalance(wallet.address),
          client.getContractState(wallet.address),
        ]);
        const deployed = state.state === "active";
        const info = {
          address: wallet.address.toString({ bounceable: !deployed }),
          rawAddress: wallet.address.toRawString(),
          balance: fromNano(balance),
          balanceNano: balance.toString(),
          deployed,
          currentQueryId: sequence.current(),
          hasNext: sequence.hasNext(),
        };
        if (!deployed) return info;

        const opened = client.open(wallet);
        const [timeout, lastCleaned, subwalletId] = await Promise.all([
          opened.getTimeout(),
          opened.getLastCleaned(),
          opened.getSubwalletId(),
        ]);
        return { ...info, timeout, lastCleaned, subwalletId };
      } catch (error) {
        throw new PluginSDKError(
          `Failed to read Highload wallet: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },

    async fund(amount) {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new PluginSDKError("Amount must be a positive number", "OPERATION_FAILED");
      }
      const info = await this.getInfo();
      return fundWallet(info.address, amount, info.deployed);
    },

    async sendMessages(messages, opts) {
      if (messages.length < 1 || messages.length > MAX_MESSAGES) {
        throw new PluginSDKError(
          `Highload batches require 1 to ${MAX_MESSAGES} messages`,
          "OPERATION_FAILED"
        );
      }
      for (const message of messages) {
        try {
          Address.parse(message.to);
        } catch {
          throw new PluginSDKError(`Invalid TON address: ${message.to}`, "INVALID_ADDRESS");
        }
        if (!Number.isFinite(message.value) || message.value < 0) {
          throw new PluginSDKError("Message value must be non-negative", "OPERATION_FAILED");
        }
      }
      const valuePerBatch = opts?.valuePerBatch ?? 0.05;
      if (!Number.isFinite(valuePerBatch) || valuePerBatch < 0) {
        throw new PluginSDKError("valuePerBatch must be non-negative", "OPERATION_FAILED");
      }

      try {
        return await withTxLock(async () => {
          const { keyPair, wallet, client } = await context();
          const database = stateDb();
          const rawAddress = wallet.address.toRawString();
          const sequence = loadSequence(
            database,
            rawAddress,
            legacyPluginDb,
            pluginName === "multisend"
          );
          if (!sequence.hasNext()) {
            throw new PluginSDKError("Highload query sequence exhausted", "OPERATION_FAILED");
          }
          const queryId = sequence.current();
          sequence.next();
          // Persist before broadcast so a crash cannot reuse an accepted query ID.
          saveSequence(database, rawAddress, sequence);

          await client
            .open(wallet)
            .sendBatch(keyPair.secretKey, queryId, messages, toNano(valuePerBatch.toString()));
          log.info(`Highload batch submitted with query ID ${queryId}`);
          return {
            address: wallet.address.toString({ bounceable: true }),
            queryId,
            nextQueryId: sequence.current(),
            recipientCount: messages.length,
          };
        });
      } catch (error) {
        if (error instanceof PluginSDKError) throw error;
        throw new PluginSDKError(
          `Failed to send Highload batch: ${getErrorMessage(error)}`,
          "OPERATION_FAILED"
        );
      }
    },
  };
}
