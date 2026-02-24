# Test Plan: Reply Context Awareness

## Strategy
- Unit tests: Vitest, co-located in `src/**/__tests__/`
- Focus on envelope formatting (pure function) + bridge parsing (mock GramJS)

## Coverage Target
All new code must have tests. Key areas: envelope formatting, reply resolution, DB persistence.

## Test Scenarios

### Envelope Formatting (`src/memory/__tests__/envelope-reply.test.ts`)
| # | Scenario | Type | Priority | Verification |
|---|----------|------|----------|-------------|
| 1 | Reply context renders `[In reply to sender: "text"]` before body | Unit | P0 | `npx vitest run src/memory/__tests__/envelope-reply.test.ts` |
| 2 | Reply text truncated to 200 chars with `...` | Unit | P0 | same |
| 3 | Reply text exactly 200 chars — no `...` | Unit | P1 | same |
| 4 | Reply context with no sender name shows `[In reply to unknown: "text"]` | Unit | P1 | same |
| 5 | Reply context for agent's message shows `[In reply to agent: "text"]` | Unit | P0 | same |
| 6 | No reply context — envelope unchanged (regression) | Unit | P0 | same |
| 7 | Reply context with special chars in text (XML-like, quotes) — properly escaped | Unit | P1 | same |
| 8 | Reply context + media annotation — both rendered correctly | Unit | P1 | same |

### Bridge Parsing (`src/telegram/__tests__/bridge-reply.test.ts`)
| # | Scenario | Type | Priority | Verification |
|---|----------|------|----------|-------------|
| 1 | Message with `replyTo.replyToMsgId` extracts `replyToId` | Unit | P0 | `npx vitest run src/telegram/__tests__/bridge-reply.test.ts` |
| 2 | Message without `replyTo` — `replyToId` is `undefined` | Unit | P0 | same |
| 3 | `getReplyMessage()` returns message — text + sender extracted | Unit | P0 | same |
| 4 | `getReplyMessage()` times out (>5s) — `replyToId` set, text undefined | Unit | P1 | same |
| 5 | `getReplyMessage()` throws — graceful fallback, no crash | Unit | P1 | same |

### Handler Integration (`src/telegram/__tests__/handler-reply.test.ts`)
| # | Scenario | Type | Priority | Verification |
|---|----------|------|----------|-------------|
| 1 | `storeTelegramMessage` persists `replyToId` in DB | Unit | P0 | `npx vitest run src/telegram/__tests__/handler-reply.test.ts` |
| 2 | Reply context passed to `agent.processMessage()` | Unit | P0 | same |
| 3 | Non-reply message — no reply context passed | Unit | P0 | same |

### Full Pipeline (existing test suite)
| # | Scenario | Type | Priority | Verification |
|---|----------|------|----------|-------------|
| 1 | All existing 990+ tests still pass | Regression | P0 | `npm test` |
