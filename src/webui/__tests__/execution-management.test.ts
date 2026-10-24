import { deliverAgentResponse } from "../../agent/delivery.js";
import {
  reserveTurnIngress,
  completeTurnIngress,
  recoverTurnIngress,
} from "../../memory/turn-ingress.js";
import { listResponseDeliveries } from "../../memory/response-deliveries.js";
import type { AgentResponse } from "../../agent/turn-types.js";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSchema } from "../../memory/schema.js";
import {
  completeActionExecution,
  listActionExecutions,
  reserveActionExecution,
} from "../../memory/action-executions.js";
import { TaskStore } from "../../memory/agent/tasks.js";
import { createOperationsRoutes } from "../routes/operations.js";
import { createTasksRoutes } from "../routes/tasks.js";
import type { WebUIServerDeps } from "../types.js";

describe("execution administration", () => {
  let db: Database.Database;
  let app: Hono;
  beforeEach(() => {
    db = new Database(":memory:");
    ensureSchema(db);
    const deps = { memory: { db } } as WebUIServerDeps;
    app = new Hono();
    app.route("/operations", createOperationsRoutes(deps));
    app.route("/tasks", createTasksRoutes(deps));
  });
  afterEach(() => db.close());
  const post = (path: string, body: unknown) =>
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("requires evidence and the current revision to resolve an unknown operation", async () => {
    const reservation = reserveActionExecution(db, "t", "send", { amount: 1 });
    if (reservation.kind !== "execute") throw new Error("missing reservation");
    completeActionExecution(db, "t", "send", reservation.argsHash, {
      success: false,
      execution: { outcome: "unknown" },
    });
    const operation = listActionExecutions(db)[0];
    expect(
      (
        await app.request(
          post(`/operations/${operation.operation_id}/resolve`, {
            revision: operation.revision,
            outcome: "succeeded",
            note: "",
          })
        )
      ).status
    ).toBe(400);
    expect(
      (
        await app.request(
          post(`/operations/${operation.operation_id}/resolve`, {
            revision: 999,
            outcome: "succeeded",
            note: "verified",
          })
        )
      ).status
    ).toBe(409);
    expect(
      (
        await app.request(
          post(`/operations/${operation.operation_id}/resolve`, {
            revision: operation.revision,
            outcome: "succeeded",
            note: "remote transaction receipt",
            remoteReference: "tx123",
          })
        )
      ).status
    ).toBe(200);
    const detail = await (await app.request(`/operations/${operation.operation_id}`)).json();
    expect(detail.data).toMatchObject({
      status: "succeeded",
      remote_reference: "tx123",
      resolution_note: "remote transaction receipt",
    });
    expect(
      (
        await app.request(
          post(`/operations/${operation.operation_id}/resolve`, {
            revision: operation.revision,
            outcome: "failed",
            note: "stale decision",
          })
        )
      ).status
    ).toBe(409);
  });

  it("keeps unresolved tasks out of bulk deletion and requires a reviewed CAS resolution", async () => {
    const store = new TaskStore(db);
    const task = store.createTask({ description: "uncertain" });
    const run = store.startTask(task.id)!;
    store.finishTask(task.id, run.runId!, run.revision, "unknown");
    const current = store.getTask(task.id)!;
    expect((await app.request(`/tasks/${task.id}`, { method: "DELETE" })).status).toBe(409);
    expect((await app.request(post("/tasks/clean", { status: "unknown" }))).status).toBe(400);
    expect((await app.request(post(`/tasks/${task.id}/cancel`, {}))).status).toBe(409);
    expect(
      (
        await app.request(
          post(`/tasks/${task.id}/resolve`, {
            revision: current.revision,
            status: "done",
            note: "checked result",
          })
        )
      ).status
    ).toBe(200);
    expect(store.getTask(task.id)?.status).toBe("done");
    expect(
      (
        await app.request(
          post(`/tasks/${task.id}/resolve`, {
            revision: current.revision,
            status: "failed",
            note: "old",
          })
        )
      ).status
    ).toBe(409);
  });
  it("creates a linked new task only after explicit resolution and preserves its prior run", async () => {
    const store = new TaskStore(db);
    const task = store.createTask({
      description: "new attempt",
      originSenderId: 123,
      originChatId: "123",
      originIsGroup: false,
    });
    const run = store.startTask(task.id)!;
    const stopped = store.finishTask(task.id, run.runId!, run.revision, "incomplete")!;
    expect(
      (
        await app.request(
          post(`/tasks/${task.id}/new-attempt`, { revision: stopped.revision, note: "too early" })
        )
      ).status
    ).toBe(409);
    const resolved = store.resolveTask(
      task.id,
      stopped.revision,
      "cancelled",
      "reviewed all previous effects"
    )!;
    const response = await app.request(
      post(`/tasks/${task.id}/new-attempt`, {
        revision: resolved.revision,
        note: "start new intention",
      })
    );
    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({
      replacesTaskId: task.id,
      status: "pending",
    });
    expect(store.listTaskRuns(task.id)).toMatchObject([
      { status: "incomplete", resolution_status: "cancelled" },
    ]);
  });

  it("retries only the persisted delivery after a confirmed rejection, without calling a model", async () => {
    const bridge = {
      getMode: () => "bot",
      getOwnUserId: () => 1n,
      clearDraft: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce({ error_code: 400, description: "rejected" })
        .mockResolvedValue({ id: 77, date: 100, chatId: "123" }),
    };
    const agent = { processMessage: vi.fn() };
    const deps = { memory: { db }, bridge, agent } as unknown as WebUIServerDeps;
    app = new Hono();
    app.route("/operations", createOperationsRoutes(deps));
    const answer: AgentResponse = {
      turnId: "delivery-turn",
      content: "stored answer",
      outcome: { status: "completed", reason: "completed" },
      delivery: { state: "not_requested" },
    };
    reserveTurnIngress(db, {
      key: "event",
      turnId: answer.turnId,
      chatId: "123",
      text: "question",
    });
    completeTurnIngress(db, "event", answer);
    const first = await deliverAgentResponse(db, answer, {
      kind: "telegram",
      bridge: deps.bridge,
      chatId: "123",
    });
    expect(first.delivery.state).toBe("failed");
    const delivery = listResponseDeliveries(db)[0];
    db.prepare("UPDATE response_deliveries SET resolution_note = ? WHERE delivery_id = ?").run(
      "Prior reconciliation evidence",
      delivery.delivery_id
    );
    expect(
      (
        await app.request(
          post(`/operations/deliveries/${delivery.delivery_id}/retry`, {
            revision: delivery.revision - 1,
            note: "stale",
          })
        )
      ).status
    ).toBe(409);
    const response = await app.request(
      post(`/operations/deliveries/${delivery.delivery_id}/retry`, {
        revision: delivery.revision,
        note: "verified rejection, fixed transport",
      })
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.state).toBe("delivered");
    expect(bridge.sendMessage).toHaveBeenCalledTimes(2);
    expect(agent.processMessage).not.toHaveBeenCalled();
    expect(listResponseDeliveries(db)[0].resolution_note).toBe(
      "Prior reconciliation evidence\nRetry: verified rejection, fixed transport"
    );
  });
  it("filters explicit turn outcomes and joins model attempts with authoritative outbox delivery", async () => {
    const answer: AgentResponse = {
      turnId: "turn-observed",
      content: "partial answer",
      outcome: { status: "incomplete", reason: "iteration_budget" },
      delivery: { state: "unknown", reason: "stale projection" },
    };
    reserveTurnIngress(db, {
      key: "observed",
      turnId: answer.turnId,
      chatId: "123",
      text: "question",
    });
    completeTurnIngress(db, "observed", answer);
    const bridge = {
      getMode: () => "bot",
      getOwnUserId: () => 1n,
      clearDraft: vi.fn().mockResolvedValue(undefined),
      sendMessage: vi.fn().mockResolvedValue({ id: 80, date: 100, chatId: "123" }),
    };
    await deliverAgentResponse(db, answer, {
      kind: "telegram",
      bridge: bridge as never,
      chatId: "123",
    });
    db.prepare(
      `INSERT INTO model_attempts(id,turn_id,provider,model,purpose,started_at,completed_at,duration_ms,stop_reason,usage_json,incomplete)
      VALUES('model-1',?,'fake','model','main',1,2,1,'length','{"input":5}',1)`
    ).run(answer.turnId);
    reserveTurnIngress(db, {
      key: "interrupted",
      turnId: "turn-interrupted",
      chatId: "123",
      text: "other",
    });
    recoverTurnIngress(db);
    const filtered = await (await app.request("/operations/turns?outcome=incomplete")).json();
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0].turnId).toBe(answer.turnId);
    const detail = await (await app.request(`/operations/turns/${answer.turnId}`)).json();
    expect(detail.data).toMatchObject({
      outcome: { status: "incomplete", reason: "iteration_budget" },
      delivery: { state: "delivered" },
      modelAttempts: [{ model: "model", incomplete: true, usage: { input: 5 } }],
    });
    expect(
      (await (await app.request("/operations/turns?outcome=unknown")).json()).data
    ).toMatchObject([{ turnId: "turn-interrupted", outcome: { status: "unknown" } }]);
    expect((await app.request("/operations/turns?outcome=invalid")).status).toBe(400);
    expect((await app.request("/operations/turns/missing")).status).toBe(404);
  });
});
