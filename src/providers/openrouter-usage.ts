import type { AssistantMessage, Usage } from "@earendil-works/pi-ai/compat";
import { createParser } from "eventsource-parser";

export type CostAwareUsage = Usage & { costIncomplete?: boolean };

/** Read billing metadata without changing or buffering the provider's response stream. */
export function createOpenRouterUsageTracker(unknownPricing: boolean) {
  let reportedCost: number | undefined;

  const trackedFetch: typeof globalThis.fetch = async (input, init) => {
    reportedCost = undefined;
    const response = await globalThis.fetch(input, init);
    if (!response.ok || !response.body) return response;

    const decoder = new TextDecoder();
    const parser = createParser({
      onEvent(event) {
        if (event.data === "[DONE]") return;
        try {
          const chunk = JSON.parse(event.data);
          const cost: unknown = chunk?.usage?.cost;
          if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
            reportedCost = cost;
          }
        } catch {
          // The normal pi-ai adapter remains responsible for malformed responses.
        }
      },
    });
    const body = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          parser.feed(decoder.decode(chunk, { stream: true }));
          controller.enqueue(chunk);
        },
        flush() {
          parser.feed(decoder.decode());
          parser.reset({ consume: true });
        },
      })
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    fetch: trackedFetch,
    apply(message: AssistantMessage) {
      const usage: CostAwareUsage = message.usage;
      if (reportedCost !== undefined) {
        usage.cost.total = reportedCost;
      } else if (unknownPricing) {
        usage.costIncomplete = true;
      }
    },
  };
}
