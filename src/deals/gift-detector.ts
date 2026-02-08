/**
 * Gift detector - polls telegram_get_my_gifts to detect newly received gifts
 */

import type { ToolContext } from "../agent/tools/types.js";
import { telegramGetMyGiftsExecutor } from "../agent/tools/telegram/gifts/get-my-gifts.js";
import type { ReceivedGift } from "./types.js";
import { DEFAULT_GIFTS_QUERY_LIMIT } from "../constants/limits.js";

export class GiftDetector {
  private seenGifts: Map<number, Set<string>> = new Map(); // userId → Set<msgId>

  /**
   * Detect new gifts received by checking telegram_get_my_gifts
   * Returns only gifts that weren't seen before
   */
  async detectNewGifts(userId: number, context: ToolContext): Promise<ReceivedGift[]> {
    try {
      // Get current gifts
      const result = await telegramGetMyGiftsExecutor(
        {
          userId: userId.toString(),
          limit: DEFAULT_GIFTS_QUERY_LIMIT,
        },
        context
      );

      if (!result.success || !result.data) {
        return [];
      }

      const gifts = (result.data as any).gifts || [];

      // Get cached set of seen gifts for this user
      const seenSet = this.seenGifts.get(userId) || new Set<string>();

      // Find new gifts (not in cache)
      const newGifts: ReceivedGift[] = [];
      const currentMsgIds = new Set<string>();

      for (const gift of gifts) {
        currentMsgIds.add(gift.msgId);

        if (!seenSet.has(gift.msgId)) {
          newGifts.push({
            msgId: gift.msgId,
            slug: gift.slug,
            name: gift.title || gift.slug,
            fromUserId: gift.fromId ? Number(gift.fromId) : undefined,
            fromUsername: gift.fromUsername,
            receivedAt: gift.date || Date.now(),
          });
        }
      }

      // Update cache with current state
      this.seenGifts.set(userId, currentMsgIds);

      if (newGifts.length > 0) {
        console.log(`🎁 [GiftDetector] Detected ${newGifts.length} new gift(s) for user ${userId}`);
      }

      return newGifts;
    } catch (error) {
      console.error(`❌ [GiftDetector] Error detecting gifts for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Reset cache for a specific user (useful after trades)
   */
  resetCache(userId: number): void {
    this.seenGifts.delete(userId);
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.seenGifts.clear();
  }
}
