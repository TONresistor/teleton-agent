# Context: Reply Context Awareness

> Load this file at the start of your implementation session.
> It contains everything you need to implement `specs/reply-context/`.

## Objective
Inject replied-to message context into the LLM prompt so the agent knows when a user is replying to a specific message, in both DMs and groups.

## Spec Location
`specs/reply-context/` — read README.md first, then requirements.md + architecture.md

## Codebase Orientation

### Tech Stack
- TypeScript + Node.js, GramJS for Telegram user client
- Build: `npm run build:backend` (tsup, fast)
- Test: `npm test` or `npx vitest run` (990+ tests)
- Lint: `npm run lint`

### Key Files to Read First
- `src/telegram/bridge.ts:8-24` — `TelegramMessage` interface (add `replyToId`, `replyToText`, `replyToSenderName`)
- `src/telegram/bridge.ts:259-357` — `parseMessage()` (extract reply data here)
- `src/telegram/handlers.ts:434-468` — `storeTelegramMessage()` (line 463: `replyToId: undefined` must use actual value)
- `src/telegram/handlers.ts:362-374` — `agent.processMessage()` call (pass reply context)
- `src/agent/runtime.ts:168-234` — `processMessage()` signature + envelope building
- `src/memory/envelope.ts:3-121` — `EnvelopeParams` interface + `formatMessageEnvelope()` (add reply annotation)
- `src/memory/feed/messages.ts:5-15` — `TelegramMessage` (DB interface, already has `replyToId`)
- `CLAUDE.md` — project conventions

### Existing Patterns to Follow
- Timeout pattern: `Promise.race([actualCall(), new Promise(resolve => setTimeout(() => resolve(undefined), 5000))])` — used in `bridge.ts:284-286` for `getSender()`
- Media annotation pattern: `[emoji type msg_id=X] body` — used in `envelope.ts:106-117`
- Optional additive fields: new interface fields are optional (`?:`) to avoid breaking existing callers
- `sanitizeForPrompt()` used on all user-provided text before injection into prompt
- Tests in `src/**/__tests__/` directories

## Key Decisions
- **Single message depth:** Only fetch the one replied-to message, not a reply chain. Keeps it simple and token-efficient.
- **Inline annotation format:** `[In reply to <sender>: "<text>"]` — matches existing envelope annotation patterns (media, etc.)
- **GramJS `getReplyMessage()` as primary source:** Fetches text + sender in one call. DB `tg_messages` is NOT used as source because the sender name isn't stored there (only `sender_id`). The bridge extracts everything from the GramJS reply message object.
- **200 char truncation:** Quoted text capped at 200 chars with `...` — ~50 tokens overhead max.
- **Graceful degradation:** If `getReplyMessage()` fails/times out, still set `replyToId` on the message but skip the text annotation. If the replied-to message is deleted, show `[In reply to msg #1234]` (ID only).
- **CRITICAL — Fetch only when responding:** The `getReplyMessage()` API call (expensive, 100-500ms) happens ONLY inside `handleMessage()` AFTER `shouldRespond: true` is confirmed. `parseMessage()` only extracts the lightweight `replyToMsgId` integer. Group messages that are "Not mentioned" never trigger the API call — they just get `replyToId` persisted in DB (cheap) and go into `pendingHistory`.

## Lore (Gotchas & Non-Obvious Knowledge)
- **USE `msg.replyToMsgId` GETTER** — GramJS custom Message class exposes a convenience getter (message.d.ts:397). Do NOT dig into `msg.replyTo.replyToMsgId` manually.
- `msg.replyTo` is typed as `TypeMessageReplyHeader = MessageReplyHeader | MessageReplyStoryHeader`. The getter handles both types.
- `getReplyMessage()` returns `Promise<Api.Message | undefined>` — undefined for deleted messages. Handle gracefully.
- **CRITICAL: `_rawMessage` is only set for media messages** (bridge.ts:355: `hasMedia ? msg : undefined`). Must change to `hasMedia || replyToMsgId ? msg : undefined`, otherwise text-only replies lose the raw msg reference and we can't call `getReplyMessage()` from the handler.
- The `TelegramMessage` interface in `bridge.ts:8` is DIFFERENT from the one in `messages.ts:5` — the bridge one is the runtime type, the messages.ts one is the DB type. Both already have `replyToId` (messages.ts) / need `replyToId` (bridge.ts).
- `storeTelegramMessage()` at line 463 hardcodes `replyToId: undefined` — this is the bug to fix
- `processMessage()` has 11 positional parameters. Add `replyContext` as the 12th optional param. **Second caller at `src/index.ts:748`** (self-scheduled tasks) won't break since param is optional.
- **Envelope format**: currently returns single-line `${header} ${body}`. With reply context, use multi-line: `${header}\n[↩ reply to sender: "text"]\n${body}`. Without reply, keep the current single-line format.
- `sanitizeForPrompt()` from `src/utils/sanitize.ts` must be called on quoted text to prevent prompt injection (consistent with existing usage in envelope.ts:65)
- Group messages already include sender label in body (`senderLabel: <user_message>text</user_message>`) — the reply annotation goes on its own line between header and body
- GramJS `msg.date` is in seconds, `msg.timestamp` in the bridge is a `Date` object

## Implementation Order (suggested)

1. **Bridge: Extract replyToId (lightweight) + add fetchReplyContext helper** — `src/telegram/bridge.ts`
   - Add `replyToId?: number` to `TelegramMessage` interface (line 8)
   - In `parseMessage()`, after the media detection block (~line 338), extract the ID using the GramJS getter:
     ```
     const replyToMsgId = msg.replyToMsgId; // GramJS getter, returns number | undefined
     ```
     **NOTE:** Do NOT use `msg.replyTo.replyToMsgId` — use the convenience getter `msg.replyToMsgId` directly.
   - **CRITICAL FIX:** Change `_rawMessage` assignment (line 355) from:
     ```
     _rawMessage: hasMedia ? msg : undefined
     ```
     to:
     ```
     _rawMessage: hasMedia || replyToMsgId ? msg : undefined
     ```
     Without this, text-only reply messages won't have the raw msg reference needed for `getReplyMessage()`.
   - Return `replyToId: replyToMsgId` in the message object. NO API call here.
   - Add a new public method on `TelegramBridge`:
     ```
     async fetchReplyContext(rawMsg: Api.Message): Promise<{text?: string, senderName?: string, isAgent?: boolean} | undefined>
     ```
     This calls `rawMsg.getReplyMessage()` with 5s timeout (same pattern as `getSender()` at line 284-286).
     Uses `this.ownUserId` to determine `isAgent`. Only called by handlers when responding.

2. **Envelope: Add reply annotation** — `src/memory/envelope.ts`
   - Add `replyContext?: { senderName?: string; text: string; isAgent?: boolean }` to `EnvelopeParams`
   - In `formatMessageEnvelope()`, after building `header` and `body`, change the return:
     ```
     if (params.replyContext) {
       const sender = params.replyContext.isAgent ? "agent" : sanitizeForPrompt(params.replyContext.senderName ?? "unknown");
       let quotedText = sanitizeForPrompt(params.replyContext.text);
       if (quotedText.length > 200) quotedText = quotedText.slice(0, 200) + "...";
       return `${header}\n[↩ reply to ${sender}: "${quotedText}"]\n${body}`;
     }
     return `${header} ${body}`;  // existing single-line format
     ```
   - **Note:** The current return at line 120 is `${header} ${body}` (single-line). With reply context, we switch to multi-line to keep the annotation visually separate. Without reply context, format is unchanged.

3. **Handlers: Wire replyToId storage + resolve context ONLY when responding** — `src/telegram/handlers.ts`
   - In `storeTelegramMessage()` line 463: change `replyToId: undefined` to `replyToId: message.replyToId?.toString()` — always, cheap
   - In `handleMessage()` **inside the `chatQueue.enqueue()` callback** (~line 345, after shouldRespond is confirmed):
     ```
     let replyContext;
     if (message.replyToId && message._rawMessage) {
       replyContext = await this.bridge.fetchReplyMessage(message._rawMessage);
     }
     ```
   - Pass `replyContext` to `agent.processMessage()` call
   - **This code path is ONLY reached for messages the agent will respond to** — group messages that are "Not mentioned" exit at line 305 before ever reaching the enqueue block

4. **Runtime: Accept and forward reply context** — `src/agent/runtime.ts`
   - Add `replyContext?` parameter to `processMessage()` (optional, after `messageId`)
   - Pass to `formatMessageEnvelope()` in the `EnvelopeParams`

5. **Tests** — Write tests for envelope, bridge parsing, and handler wiring

## Verification Commands
- `npm test` — all 990+ tests must pass
- `npx vitest run src/memory/__tests__/envelope` — envelope tests
- `npx vitest run src/telegram/__tests__/` — bridge + handler tests
- `npm run build:backend` — no type errors
- `npm run lint` — no lint warnings

## Warnings
- Do NOT change group trigger logic in `handlers.ts:224-258` — reply-to-agent already triggers via `msg.mentioned`
- Do NOT fetch reply chains (only single message)
- Do NOT use `msg.replyTo` without checking it exists and has `replyToMsgId` — some message types have different reply header shapes
- The `processMessage()` function has 11+ positional params — adding one more is acceptable but consider the readability tradeoff
- Call `sanitizeForPrompt()` on ALL quoted text to prevent prompt injection via crafted reply messages
