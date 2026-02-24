# Requirements: Reply Context Awareness

## Problem Statement
When a user replies to a message (their own or the agent's) in DMs or groups, the agent has zero visibility into which message was replied to. The LLM receives the new message text but has no idea it references a specific prior message. This breaks conversational coherence when the user says things like "yes" or "I meant the other one" in reply to a specific message.

## Goals
- Agent sees replied-to message content in its LLM context, formatted as an inline annotation
- `reply_to_id` is persisted in the database for all incoming messages (currently hardcoded to `undefined`)
- Works in both DM and group contexts with appropriate scoping

## Non-Goals (explicitly out of scope)
- Thread chain reconstruction (only single replied-to message, not the full chain)
- Changing group trigger logic (reply-to-agent already works via `msg.mentioned`)
- Fetching reply context for messages the agent doesn't process (non-mentioned group messages)
- Reply context for outgoing agent messages (only incoming user messages)

## User Stories
- As a DM user, I want to reply to a specific message so that the agent understands what I'm referring to
- As a group user, I want to reply to the agent's message so the agent knows which of its messages I'm responding to
- As a group user, I want to reply to someone else's message and @mention the agent so it understands the full context

## Acceptance Criteria (Given/When/Then)

### DM: User replies to agent's message
- **Given** a DM conversation where the agent previously sent "Your balance is 100 TON"
- **When** the user replies to that specific message with "convert it to USD"
- **Then** the agent's context contains `[In reply to agent: "Your balance is 100 TON"]` before the user message

### DM: User replies to their own message
- **Given** a DM conversation where the user previously sent "check wallet A"
- **When** the user replies to their own message with "actually check wallet B instead"
- **Then** the agent's context contains `[In reply to user: "check wallet A"]` before the user message

### Group: User replies to agent's message
- **Given** a group where the agent said "Done, transaction sent"
- **When** a user replies to that message (triggering via `msg.mentioned`)
- **Then** the agent's context contains `[In reply to agent: "Done, transaction sent"]` before the user message

### Group: User replies to another message and @mentions agent
- **Given** a group where Alice said "I need help with my wallet"
- **When** Bob replies to Alice's message with "@agent help her"
- **Then** the agent's context contains `[In reply to Alice: "I need help with my wallet"]` before Bob's message

### Long quoted text is truncated
- **Given** a replied-to message with 500+ characters
- **When** the reply context is built
- **Then** the quoted text is truncated to 200 characters with "..." appended

### Replied-to message not in DB
- **Given** a reply to a message that predates the agent's database
- **When** the reply context is being resolved
- **Then** the system fetches the message from Telegram API via `getReplyMessage()` with a 5s timeout
- **And** if that also fails, the reply annotation shows `[In reply to msg #1234]` (ID only, no text)

## Constraints
- Max 5s timeout for Telegram API fallback (consistent with existing `getSender()` pattern)
- Reply annotation must not break existing envelope XML tag structure (`<user_message>` tags)
- Zero impact on messages that are NOT replies (no extra DB queries, no latency)
