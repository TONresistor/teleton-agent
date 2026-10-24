/** Runtime outcomes are distinct from remote effects and response delivery. */
export type TurnStatus =
  "completed" | "incomplete" | "blocked" | "failed" | "interrupted" | "unknown";

export interface TurnOutcome {
  status: TurnStatus;
  reason: string;
}

export type EffectOutcome = "not_attempted" | "running" | "succeeded" | "failed" | "unknown";

export type DeliveryState =
  | "not_requested"
  | "suppressed"
  | "prepared"
  | "sending"
  | "delivered"
  | "partial"
  | "failed"
  | "unknown";

export interface DeliveryReceipt {
  deliveryId?: string;
  state: DeliveryState;
  messageIds?: number[];
  reason?: string;
}

export interface TurnAdmission {
  receivedAt: number;
  queueDeadline: number;
  executionDeadline?: number;
  signal?: AbortSignal;
}

export function outcomeForStopReason(reason: string): TurnOutcome {
  if (reason === "effect_unknown" || reason === "persistence_failed") {
    return { status: "unknown", reason };
  }
  if (reason.endsWith("budget") || reason === "model_length") {
    return { status: "incomplete", reason };
  }
  if (reason === "aborted") return { status: "interrupted", reason };
  if (reason === "hook_blocked" || reason === "permission_denied") {
    return { status: "blocked", reason };
  }
  if (reason === "completed" || reason === "completed_with_fallback") {
    return { status: "completed", reason };
  }
  return { status: "failed", reason };
}
