import type { Config } from "../config/schema.js";

export interface TurnAuthority {
  chatId: string;
  policyChatId?: string;
  isGroup?: boolean;
  isGuest?: boolean;
  toolContext?: { senderId?: number };
}

/** Authority comes from the authenticated ingress, never from a chat or prompt. */
export function authorizeTurn(
  config: Config,
  input: TurnAuthority
): { allowed: boolean; reason: string } {
  const senderId = input.toolContext?.senderId;
  if (typeof senderId !== "number" || !Number.isSafeInteger(senderId) || senderId <= 0) {
    return { allowed: false, reason: "A verified sender identity is required" };
  }
  const admin = config.telegram.admin_ids.includes(senderId);
  if (!admin && !config.telegram.allow_from.includes(senderId)) {
    return { allowed: false, reason: "Sender is not authorized to access agent memory" };
  }
  if (input.isGroup) {
    const policy = config.telegram.group_policy;
    if (policy === "disabled" || (policy === "admin-only" && !admin)) {
      return { allowed: false, reason: "Group policy does not permit this request" };
    }
    if (policy === "allowlist") {
      const chat = input.policyChatId ?? input.chatId;
      if (!/^-?[1-9]\d*$/.test(chat) || !Number.isSafeInteger(Number(chat))) {
        return { allowed: false, reason: "A verified group identity is required" };
      }
      if (!config.telegram.group_allow_from.includes(Number(chat))) {
        return { allowed: false, reason: "Group is not authorized" };
      }
    }
  } else if (
    config.telegram.dm_policy === "disabled" ||
    (config.telegram.dm_policy === "admin-only" && !admin)
  ) {
    return { allowed: false, reason: "Direct-message policy does not permit this request" };
  }
  return { allowed: true, reason: "authorized" };
}
