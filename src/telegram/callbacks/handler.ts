/**
 * Callback query handler for inline button clicks
 */

import type { TelegramBridge } from "../bridge.js";
import type Database from "better-sqlite3";

export type CallbackHandler = (data: {
  action: string;
  params: string[];
  queryId: bigint;
  chatId: string;
  messageId: number;
  userId: number;
}) => Promise<void>;

/**
 * CallbackQueryHandler class
 * Routes callback queries to registered handlers
 */
export class CallbackQueryHandler {
  private handlers: Map<string, CallbackHandler> = new Map();

  constructor(
    private bridge: TelegramBridge,
    private db: Database.Database
  ) {}

  /**
   * Register a handler for a specific action prefix
   * Example: register("deal", dealHandler) handles all "deal:*" callbacks
   */
  register(actionPrefix: string, handler: CallbackHandler): void {
    this.handlers.set(actionPrefix, handler);
  }

  /**
   * Handle callback query event from Telegram
   */
  async handle(event: any): Promise<void> {
    try {
      const queryId = event.queryId;
      const data = event.data?.toString() || "";
      const chatId = event.peer?.toString() || event.chatInstance?.toString() || "";
      const messageId = event.msgId || 0;
      const userId = Number(event.userId);

      console.log(`📞 [Callback] Received: data="${data}" from user ${userId} in chat ${chatId}`);

      // Parse callback data: "action:param1:param2:..."
      const parts = data.split(":");
      const action = parts[0];
      const params = parts.slice(1);

      // Find handler
      const handler = this.handlers.get(action);
      if (!handler) {
        console.warn(`⚠️ No handler for callback action: ${action}`);
        await this.answerCallback(queryId, "Unknown action");
        return;
      }

      // Execute handler
      await handler({
        action,
        params,
        queryId,
        chatId,
        messageId,
        userId,
      });
    } catch (error) {
      console.error("❌ Error handling callback query:", error);
      // Answer callback with error
      if (event?.queryId) {
        await this.answerCallback(event.queryId, "An error occurred. Please try again.");
      }
    }
  }

  /**
   * Answer callback query (toast notification)
   */
  private async answerCallback(queryId: any, message?: string, alert = false): Promise<void> {
    try {
      await this.bridge.getClient().answerCallbackQuery(queryId, { message, alert });
    } catch (error) {
      console.error("Error answering callback:", error);
    }
  }
}
