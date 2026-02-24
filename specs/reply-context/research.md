# Research Notes

## Technology Research

### GramJS Reply Message API
**Question:** How to access replied-to message data from incoming GramJS events?
**Finding:** `Api.Message` has a `replyTo` field of type `MessageReplyHeader` containing `replyToMsgId: number`. The full replied-to message can be fetched via `msg.getReplyMessage()` which returns `Api.Message | undefined`. This is an async call that hits the Telegram API.
**Impact on spec:** Use `getReplyMessage()` as primary source (gets text + sender in one call), with the same 5s timeout pattern used for `getSender()` in the codebase.

### Telegram Bot API TextQuote
**Question:** Does Telegram provide the quoted text directly?
**Finding:** Telegram Bot API (not User API / GramJS) has a `TextQuote` object for manually selected quotes. GramJS user client does not expose this — only `replyToMsgId`. The full message must be fetched separately.
**Sources:** https://core.telegram.org/bots/api#textquote
**Impact on spec:** Cannot avoid the `getReplyMessage()` call; no inline quote text available in user client events.

## Best Practices & Standards

### Reply Context in LLM-Powered Chat Agents
**Industry standard:** The consensus from context engineering literature is that a reply is a "semantic anchor" — the user explicitly signals a prior message is relevant to their current utterance. Production bots use one of three patterns:
1. **Inline quote prepend** (most common, simplest) — `[In reply to: "text..."]` before user message
2. **Thread context block** — reconstruct reply chain as ordered messages
3. **XML-tagged context block** — `<reply_context>` tags (Anthropic-recommended for Claude)

**Pattern chosen:** Inline quote prepend — matches existing Teleton envelope patterns (media annotations use `[emoji type msg_id=X]` format) and keeps tokens minimal.
**Reference implementations:**
- [n3d1117/chatgpt-telegram-bot PR #351](https://github.com/n3d1117/chatgpt-telegram-bot/issues/348) — inline prepend
- [ExposedCat/tg-local-llm](https://github.com/ExposedCat/tg-local-llm) — DB-based thread grouping
- [dolmario/chatbot_context_understanding](https://github.com/dolmario/-chatbot_context_understanding) — context-aware bot

**Gotchas:**
- `getReplyMessage()` can return `undefined` for deleted messages
- In channels, `replyTo` may reference a different channel's message (cross-chat replies) — ignore these
- Token overhead: 200 chars ~ 50 tokens, acceptable

**Sources:**
- https://www.comet.com/site/blog/context-engineering/
- https://docs.langchain.com/oss/python/langchain/context-engineering
- https://docs.slack.dev/ai/ai-apps-best-practices

### XML Tag Structure for Context
**Industry standard:** Anthropic recommends descriptive XML tags for structured context injection. Tags create clear boundaries preventing prompt contamination.
**Our approach:** The codebase already uses `<user_message>` tags. The reply annotation sits OUTSIDE the `<user_message>` tags (as a header line), consistent with how media annotations work.
**Sources:** https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags
