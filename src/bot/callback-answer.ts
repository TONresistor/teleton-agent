import type { Context } from "grammy";

const answeredCallbacks = new WeakSet<Context>();

export function hasAnsweredCallback(ctx: Context): boolean {
  return answeredCallbacks.has(ctx);
}

export async function answerCallbackOnce(
  ctx: Context,
  options?: Parameters<Context["answerCallbackQuery"]>[0]
): Promise<void> {
  if (answeredCallbacks.has(ctx)) return;
  answeredCallbacks.add(ctx);

  try {
    if (options === undefined) await ctx.answerCallbackQuery();
    else await ctx.answerCallbackQuery(options);
  } catch (error) {
    answeredCallbacks.delete(ctx);
    throw error;
  }
}
