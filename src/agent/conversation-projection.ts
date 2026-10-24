import type Database from "better-sqlite3";
import type { AgentResponse } from "./turn-types.js";
import {
  deliveredTelegramStructuredMessage,
  deliveredTelegramText,
} from "./telegram-send-state.js";

/** The model journal is raw audit; only confirmed final content is conversation. */
export function resolveConversationDelivery(
  db: Database.Database,
  turnId: string,
  destination?: string
): { state: string; content?: string } {
  const row = db
    .prepare("SELECT chat_id,response_json FROM turn_ingress WHERE turn_id=?")
    .get(turnId) as { chat_id: string; response_json: string | null } | undefined;
  const chatId = destination ?? row?.chat_id;
  // The outbox can settle after generation, including after a late receipt or
  // explicit operator resolution. The cached ingress response is a projection.
  const delivery = db
    .prepare(
      `SELECT delivery_id,status FROM response_deliveries WHERE turn_id=? AND (? IS NULL OR chat_id=?)
    ORDER BY updated_at DESC LIMIT 1`
    )
    .get(turnId, chatId ?? null, chatId ?? null) as
    { delivery_id: string; status: string } | undefined;
  if (delivery) {
    const fragments = db
      .prepare(
        `SELECT text,status FROM response_delivery_fragments
      WHERE delivery_id=? ORDER BY fragment_index`
      )
      .all(delivery.delivery_id) as Array<{ text: string; status: string }>;
    const state =
      delivery.status === "delivered" &&
      fragments.some((fragment) => fragment.status !== "delivered")
        ? "unknown"
        : delivery.status;
    return { state, content: fragments.map((fragment) => fragment.text).join("") };
  }
  if (
    chatId &&
    db.prepare("SELECT 1 FROM response_deliveries WHERE turn_id=? LIMIT 1").get(turnId)
  ) {
    return { state: "not_requested" };
  }
  if (!row?.response_json) return { state: "unknown" };
  const response = JSON.parse(row.response_json) as AgentResponse;
  if (response.delivery.reason === "structured_tool_response") {
    const rich = response.toolCalls?.find(
      (call) =>
        call.result?.success &&
        (call.result.data as { deliveryKind?: string } | undefined)?.deliveryKind === "rich"
    );
    const richChat = (rich?.result?.data as { chatId?: string } | undefined)?.chatId;
    const target = chatId ?? richChat;
    const delivered = target
      ? deliveredTelegramStructuredMessage(response.toolCalls, target)
      : null;
    if (!delivered) return { state: "not_requested" };
    return {
      state: "delivered",
      content: (delivered?.result?.data as { renderedText?: string } | undefined)?.renderedText,
    };
  }
  if (
    response.delivery.reason === "exact_tool_response" &&
    chatId &&
    !deliveredTelegramText(response.toolCalls, chatId, response.content)
  )
    return { state: "not_requested" };
  return { state: response.delivery.state, content: response.content };
}
