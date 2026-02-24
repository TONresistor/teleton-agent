# Spec: Reply Context Awareness (DM + Group)

**Target:** Inject replied-to message context into LLM prompt for DMs and groups
**Date:** 2026-02-24
**Status:** Draft
**Author:** anon + Claude interview
**Complexity:** Medium

## Files
- [requirements.md](requirements.md) — Problem statement, goals, scope
- [architecture.md](architecture.md) — System design and data flow
- [research.md](research.md) — Best practices research
- [test-plan.md](test-plan.md) — Test scenarios
- [context.md](context.md) — Handoff document for implementation session

## Success Criteria
- [ ] In DMs, when user replies to any message, agent sees `[In reply to ...]` annotation in its context
- [ ] In groups, when user replies to agent's message, agent sees the reply context
- [ ] In groups, when user replies to another message AND mentions the agent, agent sees the reply context
- [ ] `reply_to_id` is populated in `tg_messages` DB table for all incoming messages
- [ ] Replied-to message text is truncated to 200 chars max
- [ ] Fallback to Telegram API when replied-to message not in local DB
- [ ] All existing tests pass, new tests cover reply context logic

## Boundaries
### Always Do
- Run `npm test` before considering implementation complete
- Truncate quoted text to 200 chars
- Use 5s timeout on GramJS API calls (consistent with existing `getSender()` pattern)

### Ask First
- N/A

### Never Do
- Do not change the group trigger logic (reply-to-agent already triggers responses)
- Do not fetch full reply chains (single message only)
- Do not modify the LLM transcript format beyond adding the reply annotation line
