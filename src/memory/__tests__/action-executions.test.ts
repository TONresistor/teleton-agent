import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureSchema } from "../schema.js";
import {
  completeActionExecution,
  hashActionArguments,
  reserveActionExecution,
} from "../action-executions.js";

describe("action execution idempotency", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
  });

  afterEach(() => db.close());

  it("uses a canonical argument hash", () => {
    expect(hashActionArguments({ b: 2, a: { d: 4, c: 3 } })).toBe(
      hashActionArguments({ a: { c: 3, d: 4 }, b: 2 })
    );
    expect(hashActionArguments(undefined)).toHaveLength(64);
  });

  it("executes once and replays the persisted result within a turn", () => {
    const first = reserveActionExecution(db, "turn-1", "ton_send", { amount: 1, to: "EQ" });
    expect(first.kind).toBe("execute");
    if (first.kind !== "execute") throw new Error("expected reservation");

    completeActionExecution(db, "turn-1", "ton_send", first.argsHash, {
      success: true,
      data: { txHash: "abc" },
    });

    expect(reserveActionExecution(db, "turn-1", "ton_send", { to: "EQ", amount: 1 })).toEqual({
      kind: "replay",
      result: { success: true, data: { txHash: "abc" } },
    });
    expect(reserveActionExecution(db, "turn-2", "ton_send", { to: "EQ", amount: 1 }).kind).toBe(
      "execute"
    );
  });

  it("fails closed while an earlier outcome is unknown", () => {
    expect(reserveActionExecution(db, "turn-1", "ton_send", { amount: 1 }).kind).toBe("execute");
    expect(reserveActionExecution(db, "turn-1", "ton_send", { amount: 1 })).toEqual({
      kind: "unknown",
    });
  });
});
