import { deliverAgentResponse } from "../../agent/delivery.js";
import type { AgentResponse } from "../../agent/turn-types.js";
import {
  listResponseDeliveries,
  listDeliveryFragments,
  getResponseDelivery,
  resolveResponseDelivery,
  prepareDeliveryRetry,
  listDeliveryAttempts,
} from "../../memory/response-deliveries.js";
import { Hono } from "hono";
import type { WebUIServerDeps } from "../types.js";
import { listActionExecutions, resolveActionExecution } from "../../memory/action-executions.js";
import { apiError } from "../http.js";

// Mounted behind the same authentication middleware as task administration.
export function createOperationsRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  app.get("/", (c) => {
    try {
      const status = c.req.query("status");
      if (
        status &&
        !["not_attempted", "running", "succeeded", "failed", "unknown"].includes(status)
      ) {
        return c.json({ success: false, error: "Invalid operation status" }, 400);
      }
      return c.json({ success: true, data: listActionExecutions(deps.memory.db, status) });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.get("/deliveries", (c) => {
    try {
      return c.json({ success: true, data: listResponseDeliveries(deps.memory.db) });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.get("/deliveries/:id", (c) => {
    try {
      const delivery = getResponseDelivery(deps.memory.db, c.req.param("id"));
      return delivery
        ? c.json({
            success: true,
            data: {
              ...delivery,
              fragments: listDeliveryFragments(deps.memory.db, delivery.delivery_id),
              attempts: listDeliveryAttempts(deps.memory.db, delivery.delivery_id),
            },
          })
        : c.json({ success: false, error: "Delivery not found" }, 404);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.post("/deliveries/:id/resolve", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        !["delivered", "not_delivered"].includes(String(body.outcome)) ||
        typeof body.note !== "string" ||
        !body.note.trim() ||
        body.note.length > 4000 ||
        (body.messageId !== undefined &&
          (!Number.isSafeInteger(body.messageId) || (body.messageId as number) <= 0))
      ) {
        return c.json(
          {
            success: false,
            error: "Expected revision, evidenced delivery outcome, and review note",
          },
          400
        );
      }
      const resolved = resolveResponseDelivery(
        deps.memory.db,
        c.req.param("id"),
        body.revision as number,
        body.outcome as "delivered" | "not_delivered",
        body.note.trim(),
        body.messageId as number | undefined
      );
      return resolved
        ? c.json({ success: true, data: { resolved: true } })
        : c.json(
            { success: false, error: "Delivery changed or is not unknown; refresh first" },
            409
          );
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.post("/deliveries/:id/retry", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        typeof body.note !== "string" ||
        !body.note.trim() ||
        body.note.length > 4000
      ) {
        return c.json(
          { success: false, error: "Expected current revision and delivery retry evidence" },
          400
        );
      }
      const delivery = getResponseDelivery(deps.memory.db, c.req.param("id"));
      if (!delivery || delivery.target_kind !== "telegram")
        return c.json(
          { success: false, error: "Only persisted Telegram chat deliveries can be retried" },
          409
        );
      const ingress = deps.memory.db
        .prepare("SELECT response_json FROM turn_ingress WHERE turn_id = ?")
        .get(delivery.turn_id) as { response_json: string | null } | undefined;
      if (!ingress?.response_json)
        return c.json(
          {
            success: false,
            error: "Persisted generated response is unavailable; generation will not be repeated",
          },
          409
        );
      if (
        !prepareDeliveryRetry(
          deps.memory.db,
          delivery.delivery_id,
          body.revision as number,
          body.note.trim()
        )
      ) {
        return c.json(
          {
            success: false,
            error: "Delivery changed, is active, or requires reconciliation before retry",
          },
          409
        );
      }
      const response = JSON.parse(ingress.response_json) as AgentResponse;
      const result = await deliverAgentResponse(deps.memory.db, response, {
        kind: "telegram",
        chatId: delivery.chat_id,
        bridge: deps.bridge,
        isGroup: /^-/.test(delivery.chat_id),
      });
      return c.json({ success: true, data: result.delivery });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  function projectTurn(row: {
    turn_id: string;
    ingress_key: string;
    chat_id: string;
    message_id: number | null;
    sender_id: number | null;
    received_at: number;
    status: string;
    response_json: string | null;
  }) {
    let response: AgentResponse | undefined;
    try {
      response = row.response_json ? (JSON.parse(row.response_json) as AgentResponse) : undefined;
    } catch {
      /* Expose missing evidence as unknown. */
    }
    const deliveries = deps.memory.db
      .prepare("SELECT * FROM response_deliveries WHERE turn_id = ? ORDER BY created_at DESC")
      .all(row.turn_id) as Array<{ delivery_id: string; status: string; reason: string | null }>;
    const latest = deliveries[0];
    const modelAttempts = (
      deps.memory.db
        .prepare("SELECT * FROM model_attempts WHERE turn_id = ? ORDER BY started_at ASC")
        .all(row.turn_id) as Array<Record<string, unknown>>
    ).map((attempt) => {
      let usage: unknown = null;
      try {
        usage = typeof attempt.usage_json === "string" ? JSON.parse(attempt.usage_json) : null;
      } catch {
        /* Keep accounting uncertainty explicit. */
      }
      return { ...attempt, usage, incomplete: attempt.incomplete === 1 };
    });
    return {
      turnId: row.turn_id,
      ingressKey: row.ingress_key,
      chatId: row.chat_id,
      messageId: row.message_id,
      senderId: row.sender_id,
      receivedAt: row.received_at,
      ingressStatus: row.status,
      outcome: response?.outcome ?? {
        status: "unknown",
        reason: row.status === "running" ? "generation_in_progress" : "No persisted turn outcome",
      },
      delivery: latest
        ? { deliveryId: latest.delivery_id, state: latest.status, reason: latest.reason }
        : (response?.delivery ?? { state: "not_requested" }),
      deliveries,
      modelAttempts,
    };
  }
  app.get("/turns", (c) => {
    try {
      const outcome = c.req.query("outcome");
      if (
        outcome &&
        !["completed", "incomplete", "blocked", "failed", "interrupted", "unknown"].includes(
          outcome
        )
      )
        return c.json({ success: false, error: "Invalid turn outcome" }, 400);
      const rows = deps.memory.db
        .prepare("SELECT * FROM turn_ingress ORDER BY received_at DESC LIMIT 500")
        .all() as Array<Parameters<typeof projectTurn>[0]>;
      const turns = rows
        .map(projectTurn)
        .filter((turn) => !outcome || turn.outcome.status === outcome);
      return c.json({ success: true, data: turns });
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.get("/turns/:id", (c) => {
    try {
      const row = deps.memory.db
        .prepare("SELECT * FROM turn_ingress WHERE turn_id = ?")
        .get(c.req.param("id")) as Parameters<typeof projectTurn>[0] | undefined;
      return row
        ? c.json({ success: true, data: projectTurn(row) })
        : c.json({ success: false, error: "Turn not found" }, 404);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.get("/:id", (c) => {
    try {
      const operation = deps.memory.db
        .prepare("SELECT * FROM action_executions WHERE operation_id = ?")
        .get(c.req.param("id"));
      return operation
        ? c.json({ success: true, data: operation })
        : c.json({ success: false, error: "Operation not found" }, 404);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  app.post("/:id/resolve", async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>();
      if (
        !Number.isSafeInteger(body.revision) ||
        (body.revision as number) < 0 ||
        !["succeeded", "failed"].includes(String(body.outcome)) ||
        typeof body.note !== "string" ||
        !body.note.trim() ||
        body.note.length > 4000 ||
        (body.remoteReference !== undefined &&
          (typeof body.remoteReference !== "string" || body.remoteReference.length > 1000))
      ) {
        return c.json(
          {
            success: false,
            error: "Expected revision, confirmed outcome, and reconciliation note",
          },
          400
        );
      }
      const resolved = resolveActionExecution(
        deps.memory.db,
        c.req.param("id"),
        body.revision as number,
        body.outcome as "succeeded" | "failed",
        body.note.trim(),
        body.remoteReference as string | undefined
      );
      return resolved
        ? c.json({ success: true, data: { resolved: true } })
        : c.json(
            {
              success: false,
              error: "Operation changed or is not unknown; refresh before resolving",
            },
            409
          );
    } catch (error) {
      return apiError(c, error, 500);
    }
  });
  return app;
}
