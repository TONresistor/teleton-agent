/**
 * Callback router - routes callback queries to appropriate handlers
 * Note: Deal callbacks are now handled by the Grammy DealBot (src/bot/)
 */

import { CallbackQueryHandler } from "./handler.js";
import type { TelegramBridge } from "../bridge.js";
import type Database from "better-sqlite3";

/**
 * Initialize callback router and register all handlers
 */
export function initializeCallbackRouter(
  bridge: TelegramBridge,
  db: Database.Database
): CallbackQueryHandler {
  const handler = new CallbackQueryHandler(bridge, db);

  // Deal callbacks handled by Grammy DealBot (src/bot/index.ts)

  return handler;
}
