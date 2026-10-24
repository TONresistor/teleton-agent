import { describe, expect, it } from "vitest";
import type { Message } from "@earendil-works/pi-ai/compat";
import { collectActionReceipts, preserveActionReceipts } from "../action-receipts.js";
import { formatMessagesForSummary } from "../ai-summarization.js";
import { maskOldToolResults } from "../observation-masking.js";

const messages: Message[] = [
  {
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "transfer-1",
        name: "send",
        arguments: { amount: 8, recipient: "wallet-1" },
      },
    ],
    timestamp: 1,
  } as never,
  {
    role: "toolResult",
    toolCallId: "transfer-1",
    toolName: "send",
    isError: false,
    timestamp: 2,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          success: true,
          execution: { outcome: "succeeded", remoteId: "tx-123" },
          data: { amount: 8, tx: "tx-123" },
        }),
      },
    ],
  },
];
describe("durable context receipts", () => {
  it("survives two reductions with exact arguments and external confirmation", () => {
    const once = preserveActionReceipts(
      { messages: [{ role: "user", content: "continue", timestamp: 3 }] },
      messages
    );
    const twice = preserveActionReceipts(
      { messages: [{ role: "user", content: "new summary", timestamp: 4 }] },
      once.messages
    );
    expect(collectActionReceipts(twice.messages)).toEqual(collectActionReceipts(messages));
    expect(JSON.stringify(twice)).toContain("tx-123");
  });
  it("supplies result details and args to summaries and exempts receipts from masking", () => {
    const summary = formatMessagesForSummary(messages);
    expect(summary).toContain("wallet-1");
    expect(summary).toContain("tx-123");
    const masked = maskOldToolResults(messages, {
      config: {
        keepRecentCount: 0,
        keepErrorResults: false,
        truncationThreshold: 1,
        truncationKeepChars: 1,
      },
      currentIterationStartIndex: 3,
    });
    expect(masked[1]).toEqual(messages[1]);
  });
});

it("retains legacy financial receipts but excludes unrelated read bodies", () => {
  const source: Message[] = [
    {
      role: "toolResult",
      toolCallId: "legacy",
      toolName: "ton_send",
      isError: false,
      timestamp: 1,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            data: { txHash: "old-tx", amount: "8", recipient: "wallet" },
          }),
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "read",
      toolName: "get_history",
      isError: false,
      timestamp: 2,
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, data: { payload: "x".repeat(50_000) } }),
        },
      ],
    },
  ];
  const receipts = collectActionReceipts(source);
  expect(receipts).toHaveLength(1);
  expect(JSON.stringify(receipts)).toContain("old-tx");
  expect(JSON.stringify(receipts).length).toBeLessThan(1000);
});
