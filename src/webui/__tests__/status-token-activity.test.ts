import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createStatusRoutes } from "../routes/status.js";
import type { WebUIServerDeps } from "../types.js";

describe("WebUI token activity", () => {
  let db: Database.Database;
  let app: Hono;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T12:00:00Z"));
    db = new Database(":memory:");
    db.exec(`CREATE TABLE agent_turn_traces (
      started_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL
    )`);
    const deps = { memory: { db }, bridge: {} } as unknown as WebUIServerDeps;
    app = new Hono();
    app.route("/status", createStatusRoutes(deps));
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  it("groups recorded tokens by hour or day for each selected period", async () => {
    const insert = db.prepare(
      "INSERT INTO agent_turn_traces (started_at, status, input_tokens, output_tokens) VALUES (?, ?, ?, ?)"
    );
    insert.run(Date.parse("2026-09-23T10:30:00Z"), "completed", 100, 20);
    insert.run(Date.parse("2026-09-23T10:45:00Z"), "completed", 30, 5);
    insert.run(Date.parse("2026-09-22T18:00:00Z"), "completed", 12, 3);
    insert.run(Date.parse("2026-09-23T11:00:00Z"), "running", 999, 0);

    const day = (await (await app.request("/status/token-activity?period=day")).json()).data;
    expect(day).toHaveLength(24);
    expect(day[10]).toEqual({ label: "2026-09-23 10:00", tokens: 155 });
    expect(day[11].tokens).toBe(0);

    const week = (await (await app.request("/status/token-activity?period=week")).json()).data;
    expect(week).toHaveLength(168);
    expect(week[0].label).toBe("2026-09-21 00:00");
    expect(week[58].tokens).toBe(155);

    const month = (await (await app.request("/status/token-activity?period=month")).json()).data;
    expect(month).toHaveLength(30);
    expect(month.at(-1)).toEqual({ label: "2026-09-23", tokens: 155 });
    expect(month.at(-2)).toEqual({ label: "2026-09-22", tokens: 15 });
  });

  it("uses the browser timezone offset for local calendar buckets", async () => {
    db.prepare(
      "INSERT INTO agent_turn_traces (started_at, status, input_tokens, output_tokens) VALUES (?, ?, ?, ?)"
    ).run(Date.parse("2026-09-22T22:30:00Z"), "completed", 7, 2);

    const response = await app.request("/status/token-activity?period=day&offsetMinutes=-120");
    const { data } = await response.json();
    expect(data[0]).toEqual({ label: "2026-09-23 00:00", tokens: 9 });
  });
});
