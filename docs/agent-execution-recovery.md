# Agent execution and recovery

Teleton records three separate outcomes: the agent turn, each external action, and delivery of the final answer. A completed model response does not prove that an action succeeded or that Telegram received the answer. Use the Operations and Tasks views to review uncertain work before requesting another attempt.

## Authorization and shared memory

Every agent request needs a verified sender ID in `telegram.admin_ids` or `telegram.allow_from`. The same requirement applies before preparation in DMs, groups, guest mode and scheduled work. DM/group policies, group IDs, mention rules and individual tool permissions can restrict access further. `dm_policy: open` and `group_policy: open` do not authorize additional senders.

Authorized actors share global agent memory and retained tool artifacts across chats. This includes requests made in an admitted group: group admission does not provide private memory isolation. Add a sender only when this shared-memory access is intended. Scheduled work uses its persisted creator's identity and rechecks current authorization; older tasks without a verified creator cannot execute automatically.

## Outcome contract

| Record | States and meaning |
| --- | --- |
| Turn | `completed`, `incomplete`, `blocked`, `failed`, `interrupted`, `unknown`. Budget exhaustion and model length limits produce incomplete work; an uncertain action produces an unknown turn. |
| Action | `not_attempted`, `running`, `succeeded`, `failed`, `unknown`. Success/failure describes the external effect; local persistence errors are recorded separately. |
| Delivery | `not_requested`, `suppressed`, `prepared`, `sending`, `delivered`, `partial`, `failed`, `unknown`. Confirmed fragment IDs are retained independently of the turn outcome. |
| Task | `pending`, `in_progress`, `done`, `failed`, `cancelled`, `incomplete`, `blocked`, `unknown`. Only completed task work becomes `done` and releases dependents. A payload with `requiresDelivery: true` also requires confirmed final delivery; unknown delivery keeps the task unknown, and known non-delivery keeps it incomplete. |

Action records keep the operation ID, requested and effective arguments, remote reference when available, persistence errors, and a revision for reviewed updates. Two identical calls within one turn replay the saved result. This is exact argument deduplication, not semantic deduplication or an exactly-once guarantee across services and processes.

Coordination, draft reservations and plugin gates are process-local; run one runtime for a workspace. SQLite reservations do not provide distributed exactly-once execution.

An unresolved action prevents new actions in the same logical session. Starting another chat or changing arguments is not a reconciliation procedure. On startup, interrupted actions, deliveries and task runs are marked uncertain rather than automatically replayed. Historical run and attempt records remain available after review.

## Upgrade and backup

Schema `1.27.0` adds execution/recovery records and rebuilds some task/action tables to extend their status constraints. Existing creator information, task dependencies, indexes and legacy outcome markers are retained. Historical `running` and `failed` action rows are migrated to `unknown`; an older failure flag is not evidence of a confirmed remote failure.

Before migrating an existing on-disk database, startup creates a consistent SQLite snapshot beside it, named `<database>.pre-<old-version>-<timestamp>-<uuid>.bak`, with private permissions. Startup fails if that backup cannot be created. The database path and generated backup path appear in the migration logs. In-memory databases have no backup file.

Keep an independent backup of the workspace, database, transcripts, configuration and plugin data before upgrading. Stop and drain the process before an offline copy, or use a SQLite backup operation that includes WAL state. Copying only the main file of an open WAL database is insufficient.

For rollback, stop the process and preserve the migrated database before restoring a compatible backup. Do not run an older binary against the migrated schema. Effects performed after the backup still exist remotely; reconcile them before resuming work from an older snapshot. Restoring files does not undo payments or sent messages.

## Review an unknown action

1. Open **Operations**, select the operation, and compare its requested/effective arguments with the actual remote state. Use a transaction hash, message ID, service receipt or another independent confirmation.
2. Refresh the record. Resolve `unknown` to `succeeded` or `failed` using its current revision, an evidence note, and a remote reference when available. The server rejects stale revisions and non-unknown records.
3. Review any associated task separately. Resolving an action does not declare that the whole task completed. Mark an incomplete/unknown task `done`, `failed` or `cancelled` only after reviewing its work. A `done` resolution may release dependents.
4. If an incomplete/unknown task needs more work, explicitly create a linked **new attempt** after reconciliation. This preserves the original task/run. Creation is refused while an originating action remains unresolved or a replacement already exists.

The authenticated WebUI routes live under `/api`; the Management API exposes the same resources under `/v1`. Representative requests:

```text
GET  /api/operations?status=unknown
GET  /api/operations/<operation-id>
POST /api/operations/<operation-id>/resolve
     {"revision":3,"outcome":"succeeded","note":"Confirmed in remote history","remoteReference":"receipt-id"}
POST /api/tasks/<task-id>/resolve
     {"revision":2,"status":"failed","note":"Reviewed actions; remaining work was not completed"}
POST /api/tasks/<task-id>/new-attempt
     {"revision":3,"note":"Reviewed prior operations; request the remaining work"}
```

Fetch the current revision before each write. These endpoints record an operator's evidence; they do not independently verify blockchain or Telegram history. Avoid direct SQL status changes, deleting unresolved records, or sending a fresh request merely to bypass a block.

## Scheduled tasks and required delivery

A scheduled task uses one execution budget from acceptance, before creator checks, parent-result lookup and any direct data-bearing pre-read. The pre-read receives the absolute deadline and cancellation signal; its waiting time counts toward `agent.max_turn_duration_ms`. If it expires before or during the pre-read, the task becomes `incomplete` with a `time_budget` reason, no model request starts, and dependents remain blocked. A read that ignores cancellation may finish later, but its result cannot restart the task.

The same admission and absolute execution deadline continue into the runtime, which manages its own model/tool deadline signal. Queue waiting still has its own absolute deadline from ingress. The pre-read's synthetic cancellation signal does not carry into final delivery: once generation completes within its execution budget, delivery has its separate deadline, normally 60 seconds. A required delivery can therefore complete after the execution deadline without being classified as unknown solely because that earlier deadline passed.

By default, a failed final notification is recorded separately from the task's work. To make confirmed delivery of the final answer a completion requirement, set `requiresDelivery: true` inside the scheduling tool's JSON `payload`:

```json
{
  "description": "Prepare and deliver the daily report",
  "scheduleInSeconds": 60,
  "payload": "{\"type\":\"agent_task\",\"instructions\":\"Prepare the daily report and include it in the final response.\",\"requiresDelivery\":true}"
}
```

The flag is optional for both `agent_task` and `tool_call` payloads, defaults to `false`, and must be a boolean. It applies to the final response at the task's response destination; the runtime does not infer a delivery requirement from the task description.

With `requiresDelivery: true`, a completed generation becomes `done` only when delivery is `delivered`. An `unknown` or `sending` delivery leaves the task `unknown`; other unconfirmed states, including `failed`, `partial`, `prepared`, `suppressed` and `not_requested`, leave it `incomplete`. For these unconfirmed outcomes, the task run records `required_delivery`, and dependent tasks remain blocked. A confirmed rich response or exact text already sent to that destination satisfies the common delivery policy.

Use delivery-only recovery below to inspect or resend eligible persisted fragments. Successful delivery recovery does not automatically resolve the task: review the updated receipt, then explicitly resolve the task to `done` before releasing its dependents. When the flag is absent or false, notification errors remain separate and do not change a completed task outcome.

## Retry delivery without repeating actions

A generated answer is persisted before final delivery. Repeated ingress for the same event resumes that response instead of calling the model, message hooks, reply lookup or transcription again. A conflicting event identity is refused.

Delivery records keep the exact fragments, attempt identities and confirmed message IDs. Confirmed fragments are not sent again. An ambiguous send, including a send whose receipt could not be saved, requires review before resend; a local timeout does not establish non-delivery. A late confirmed receipt can update its original attempt, while stale receipts from older attempts are rejected.

In **Operations**, inspect a delivery and its fragments. For an unknown fragment, record evidenced `delivered` or `not_delivered` using the current revision and a note. Recording non-delivery does not itself resend anything. Explicit **Retry remaining delivery** sends the persisted Telegram response's remaining eligible fragments without generation or tool execution. This control is available for persisted Telegram destinations; it cannot reconstruct a guest callback destination.

```text
GET  /api/operations/deliveries/<delivery-id>
POST /api/operations/deliveries/<delivery-id>/resolve
     {"revision":4,"outcome":"not_delivered","note":"Confirmed absent from destination history"}
POST /api/operations/deliveries/<delivery-id>/retry
     {"revision":5,"note":"Retry only the confirmed non-delivered suffix"}
```

Silent replies, heartbeat suppression, an already-delivered rich response and exact text deduplication are checked at the actual destination. Conversation projection uses confirmed final content; raw model diagnostics are audit records, not proof that the user saw a response.

## Deadlines and plugin reloads

Queue admission has an absolute deadline, normally 60 seconds from ingress, which survives earlier pipeline waiting. Runtime coordination serializes a logical session and caps active/pending work. Execution then uses `agent.max_turn_duration_ms` (default 300000 ms), including preparation, utility-model calls, model requests and retries. Scheduled tasks establish that deadline before any direct read-only pre-read; a slow pre-read cannot start a fresh model budget. Final delivery has its own deadline, normally 60 seconds.

No new tools may start from an aborted, length-limited or late model generation. Backoff and credential refresh must fit the remaining budget. Local model deadlines bound waiting even when a provider ignores cancellation. The underlying request remains tracked; its eventual usage can update the same attempt record, and its late content cannot start tools. A local timeout is not a claim that remote computation stopped.

Already-started actions are allowed to settle. MCP has a separate local 120-second action deadline and reports an unknown remote outcome when it expires. A turn deadline therefore does not promise that every external operation has ended by that wall-clock time.

Plugin maintenance closes admission and waits for the actual executor, hook and event-handler promises before closing resources. A local read/hook timeout does not release that resource lease. Reloaded tools and hooks are published after initialization. The 30-second lifecycle deadline is diagnostic: cleanup/rollback waits for the actual start/stop promise to settle. A plugin that never settles can keep reload or shutdown waiting. Inspect active work before using a supervised process restart; startup reconciliation still applies, and restart does not prove that a remote effect failed.

## Context and accounting

Each outgoing model payload, including fallbacks and utility requests, is checked using the SDK estimate for system text, messages, thinking, tool arguments/results, supported images and tool schemas. Reserved input is `ceil(estimate × 1.2) + 4096` tokens. Output is clamped to the active model's maximum and remaining context space. These are conservative estimates, not provider tokenizer measurements.

Retrieval respects its token budget and carries source/chat/author/date/reference metadata where available. Compaction preserves structured action receipts, artifact references and a typed projection of exact earlier user requirements, independently of the prose summary. Recent user messages are kept once. Before sending an oversized request, fitting can omit explicitly tagged retrieved bodies while retaining recoverable source references, and replace optional read text with canonical artifact references. Original observations are persisted before omission; storage failure keeps the body instead of pretending it is recoverable. User requirements, action receipts, tool definitions and tool-call/result pairing are retained, including for a smaller fallback model. Provider-overflow recovery keeps the session and earlier user requirements; if a smaller safe context cannot be produced, the turn returns `context_budget` incomplete instead of resetting history blindly. Large objectives or receipts can still prevent another model request.

Usage is recorded per attempt, including terminal errors, 401 attempts before credential refresh, and summarization/slug calls. Unknown counters or missing pricing mark cost incomplete; they are not zero-cost evidence. Late provider settlement updates the same attempt ID. Provider counters and billing metadata remain the source of known usage. Embeddings and external service charges are not made comprehensive by this model-attempt ledger.

## MCP and large results

All MCP tools are conservatively treated as actions; remote `readOnlyHint` does not lower their category. Remote descriptions and results carry untrusted provenance. Typed content and `structuredContent` are retained, including error payloads. Supported images can reach an image-capable active model; unsupported images, audio and resource blocks use explicit text descriptors. Resource links are not fetched automatically.

Large results can be stored as artifacts and read with `tool_result_read` by authorized actors across chats. Each artifact is limited to 5 MiB, retained for 30 days, and paged in at most 20000-character reads. Artifact creation can fail because of size or persistence errors; an artifact reference is not guaranteed for every result. This is not a binary download or media playback interface, and multimodal provider behavior still requires service-level validation.

## Regression coverage

Paths below point to executable repository regressions for the review findings. They identify coverage, not a claim that every production scenario was tested. Some harness case labels use local scenario numbers; the C01–C15 mapping here follows the original review report.

| Review finding | Regression files and scope |
| --- | --- |
| C01 — actor authorization before memory | [`harness-integration.test.ts`](../src/agent/__tests__/harness-integration.test.ts) rejects missing/invalid/unlisted identities before preparation and checks guest denial versus authorized global retrieval with an FTS canary; [`scheduled-task-authorization.test.ts`](../src/telegram/__tests__/scheduled-task-authorization.test.ts) checks persisted/revoked creator authority; [`artifact-access.test.ts`](../src/agent/tools/__tests__/artifact-access.test.ts) checks the global artifact reader floor. This implements shared memory for authorized actors, not per-chat isolation. |
| C02 — interrupted/late generations | [`harness-integration.test.ts`](../src/agent/__tests__/harness-integration.test.ts), [`executor-deadline.test.ts`](../src/agent/loop/__tests__/executor-deadline.test.ts): partial tool calls and normal responses after deadline cannot complete or start effects. Providers are simulated. |
| C03 — durable action outcome | [`registry.test.ts`](../src/agent/tools/__tests__/registry.test.ts), [`execution-state.test.ts`](../src/memory/__tests__/execution-state.test.ts): receipt-write fault injection, exact replay, cross-turn unknown blocking, reviewed resolution. |
| C04 — receipt/constraint retention | [`action-receipts.test.ts`](../src/memory/__tests__/action-receipts.test.ts), [`compaction.test.ts`](../src/memory/__tests__/compaction.test.ts), [`overflow-recovery.test.ts`](../src/agent/loop/__tests__/overflow-recovery.test.ts): repeated reduction, summary failure, legacy receipts, preserved user limits. |
| C05 — task completion/dependencies | [`scheduled-task-authorization.test.ts`](../src/telegram/__tests__/scheduled-task-authorization.test.ts), [`execution-state.test.ts`](../src/memory/__tests__/execution-state.test.ts), [`correction-contracts.test.ts`](../src/agent/__tests__/correction-contracts.test.ts): outcome mapping, blocked descendants, stale run completion, separate notifications and explicit required-delivery failures. |
| C06 — final payload budget | [`context-budget.test.ts`](../src/agent/__tests__/context-budget.test.ts), [`prepared-context-fitting.test.ts`](../src/agent/__tests__/prepared-context-fitting.test.ts), [`model-request.test.ts`](../src/agent/__tests__/model-request.test.ts), [`context-worker.test.ts`](../src/memory/__tests__/context-worker.test.ts), [`harness-integration.test.ts`](../src/agent/__tests__/harness-integration.test.ts): estimates, clamps, retrieval limits, representative SDK payloads and persisted inbound-message continuity. No live provider tokenizer guarantee. |
| C07 — queue/request/retry deadlines | [`turn-coordinator.test.ts`](../src/agent/__tests__/turn-coordinator.test.ts), [`handlers.test.ts`](../src/telegram/__tests__/handlers.test.ts), [`attempt-usage.test.ts`](../src/agent/__tests__/attempt-usage.test.ts), [`user-delivery-budget.test.ts`](../src/telegram/__tests__/user-delivery-budget.test.ts): expiry, ignored cancellation, refresh cancellation and delivery cooldown/retry boundaries. [`correction-contracts.test.ts`](../src/agent/__tests__/correction-contracts.test.ts) verifies that a slow scheduled pre-read consumes the execution budget without starting a model request. |
| C08 — all model text blocks | [`attempt-usage.test.ts`](../src/agent/__tests__/attempt-usage.test.ts): complete multi-block text extraction alongside attempt accounting. |
| C09 — destination delivery policies | [`delivery.test.ts`](../src/agent/__tests__/delivery.test.ts), [`telegram-send-state.test.ts`](../src/agent/__tests__/telegram-send-state.test.ts), [`client-telegram-tools.test.ts`](../src/agent/__tests__/client-telegram-tools.test.ts): destination policy, rich receipt selection and send-tool guidance. [`correction-contracts.test.ts`](../src/agent/__tests__/correction-contracts.test.ts) covers streamed rich and scheduled silent/exact suppression through actual entry components. |
| C10 — Telegram formatting | [`formatted-text.test.ts`](../src/telegram/__tests__/formatted-text.test.ts), [`bot-formatted-send.test.ts`](../src/telegram/__tests__/bot-formatted-send.test.ts): nested entities, Unicode, code whitespace and all fragment IDs with a fake sender. |
| C11 — durable delivery/replay | [`delivery.test.ts`](../src/agent/__tests__/delivery.test.ts), [`handler-ingress-replay.test.ts`](../src/telegram/__tests__/handler-ingress-replay.test.ts), [`execution-management.test.ts`](../src/webui/__tests__/execution-management.test.ts): restart ambiguity, stale receipts, feed/persistence failures and delivery-only retry. |
| C12 — plugin resource lifetime | [`plugin-watcher.test.ts`](../src/agent/tools/__tests__/plugin-watcher.test.ts), [`plugin-loader.test.ts`](../src/agent/tools/__tests__/plugin-loader.test.ts), [`plugin-execution-gate.test.ts`](../src/agent/tools/__tests__/plugin-execution-gate.test.ts), [`plugin-lifecycle.test.ts`](../src/app/__tests__/plugin-lifecycle.test.ts): active executor/hook leases, startup deadlines and delayed publication. |
| C13 — attempt accounting | [`attempt-usage.test.ts`](../src/agent/__tests__/attempt-usage.test.ts), [`harness-integration.test.ts`](../src/agent/__tests__/harness-integration.test.ts): terminal usage, credential attempts, utility calls and late settlement under the same ID. |
| C14 — typed MCP content | [`mcp-content.test.ts`](../src/agent/__tests__/mcp-content.test.ts), [`mcp-loader.test.ts`](../src/agent/tools/__tests__/mcp-loader.test.ts), [`tool-result-truncator.test.ts`](../src/agent/__tests__/tool-result-truncator.test.ts): modalities/descriptors, structured data, deadlines and bounded projections. No remote MCP/media service is called. |
| C15 — new group arrivals during flush | [`debounce-ingress.test.ts`](../src/telegram/__tests__/debounce-ingress.test.ts), [`handler-ingress-replay.test.ts`](../src/telegram/__tests__/handler-ingress-replay.test.ts): both a waiting flush and an unmentioned arrival during active generation preserve the next buffer/history exactly once. |

The raw-generation/delivery distinction is additionally covered by [`conversation-projection.test.ts`](../src/agent/__tests__/conversation-projection.test.ts), including aborted diagnostics, failed delivery and hook-rewritten final text.

Migration behavior is additionally covered by [`migration-backup.test.ts`](../src/memory/__tests__/migration-backup.test.ts) and the legacy-schema cases in `execution-state.test.ts`.

## Original 36-scenario inventory

This inventory follows the 11 external reproduction files individually. The original suite recorded pre-fix behavior, including safeguards that already worked; the expectation column describes the contract to preserve. The coverage column distinguishes direct entry/component regressions from paired checks; none is a claim of live-service validation. Paths in the first column are relative to the external artifact's `reproductions/` directory.

| # | Original file and scenario | Corrected expectation and repository regression | Coverage |
| --- | --- | --- | --- |
| 1 | `context/context-review.test.ts` — Guest request exposes private cross-chat memory | An unlisted guest is blocked before retrieval or model invocation. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct guest gate and authorized global FTS-canary regression. |
| 2 | `context/context-review.test.ts` — Summary serializer loses completed-action details | Summary input includes exact tool arguments and receipt values. [action-receipts.test.ts](../src/memory/__tests__/action-receipts.test.ts) | Direct regression. |
| 3 | `context/context-review.test.ts` — 500k tool result bypasses compaction and survives masking | An exempt read still triggers compaction and the final payload gate. [compaction.test.ts](../src/memory/__tests__/compaction.test.ts) | Direct regression. |
| 4 | `context/context-review.test.ts` — ContextBuilder ignores maxTokens | Oversized retrieved chunks are removed within the supplied budget. [context-worker.test.ts](../src/memory/__tests__/context-worker.test.ts) | Direct regression. |
| 5 | `tools/repro.test.ts` — Post-hook parameters need real schema revalidation | Invalid effective arguments do not invoke the executor. [correction-contracts.test.ts](../src/agent/__tests__/correction-contracts.test.ts) | Direct real-validator/post-hook regression. |
| 6 | `tools/repro.test.ts` — Receipt-write failure overwrites confirmed success | Confirmed success survives and exact replay invokes no second effect. [registry.test.ts](../src/agent/tools/__tests__/registry.test.ts) | Direct fault-injection regression. |
| 7 | `tools/repro.test.ts` — Unknown remote outcome becomes failed in ledger | Unknown stays unknown and blocks another turn until reviewed. [registry.test.ts](../src/agent/tools/__tests__/registry.test.ts) | Direct parameterized regression. |
| 8 | `tools/repro.test.ts` — Read executor remains active after local timeout | Read timeout can return; resource cleanup waits for actual settlement. [registry.test.ts](../src/agent/tools/__tests__/registry.test.ts) | Paired with plugin-loader.test.ts hook/executor lifetime cases; no cancellation claim. |
| 9 | `tools/repro.test.ts` — MCP image/structured result becomes empty success | Image, structured-only and resource results retain typed data. [mcp-loader.test.ts](../src/agent/tools/__tests__/mcp-loader.test.ts) | Direct executor regression; transport stubbed. |
| 10 | `tools/repro.test.ts` — Successful retry helper leaves timeout timer | Successful completion clears the local timeout handle. [retry.test.ts](../src/utils/__tests__/retry.test.ts) | Direct successful-operation regression with an explicit zero-timer assertion. |
| 11 | `pipeline/queue-repros.test.ts` — Same-session waiter outlives queue deadline | Queued work expires independently of its active predecessor. [turn-coordinator.test.ts](../src/agent/__tests__/turn-coordinator.test.ts) | Direct regression, including delayed timer processing. |
| 12 | `pipeline/queue-repros.test.ts` — Outer Telegram queue precedes deadline start | Queued Telegram work uses the ingress deadline and expires. [handlers.test.ts](../src/telegram/__tests__/handlers.test.ts) | Queue boundary regression; full outer-to-inner path is not a live-load test. |
| 13 | `pipeline/delivery-repros.test.ts` — Silent token published before handler suppression | Final delivery suppresses the control token before sending. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct streamed-runtime regression with draft cleanup. |
| 14 | `pipeline/delivery-repros.test.ts` — Long bold text yields unbalanced HTML fragments | Decoded text is sent with valid fragment-local entities. [bot-formatted-send.test.ts](../src/telegram/__tests__/bot-formatted-send.test.ts) | Direct fake Bot API regression; formatted-text.test.ts covers nested entities. |
| 15 | `pipeline/delivery-repros.test.ts` — Fenced code is torn across HTML chunks | Code text, whitespace and language survive entity-safe splitting. [formatted-text.test.ts](../src/telegram/__tests__/formatted-text.test.ts) | Direct formatter regression. |
| 16 | `pipeline/delivery-repros.test.ts` — Rich response gets a second streamed acknowledgement | A confirmed rich response suppresses the extra final send. [correction-contracts.test.ts](../src/agent/__tests__/correction-contracts.test.ts) | Direct runtime/handler/Grammy regression with a fake transport. |
| 17 | `pipeline/scheduled-full-repro.test.ts` — Budget-exhausted task becomes done and releases child | The task stays incomplete and its dependent stays blocked. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct runtime/scheduler/task-store dependency regression. |
| 18 | `pipeline/scheduled-full-repro.test.ts` — Transcript claims completion after final send fails | Raw generation remains audit; failed delivery is not projected as received. [conversation-projection.test.ts](../src/agent/__tests__/conversation-projection.test.ts) | Real client/finalizer/outbox/SQLite projection with a rejected fake send. |
| 19 | `pipeline/scheduled-full-repro.test.ts` — Transcript text differs from hook-rewritten delivered text | Confirmed final text is projected while raw generation is retained. [conversation-projection.test.ts](../src/agent/__tests__/conversation-projection.test.ts) | Real client/finalizer/outbox/SQLite projection after hook rewrite. |
| 20 | `pipeline/handler-repros.test.ts` — Failed notification causes redelivery to be discarded | Persisted delivery resumes without repeating generation or hooks. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct action/provider-failure/delivery/ingress replay regression. |
| 21 | `pipeline/handler-repros.test.ts` — Drain returns before accepted handler reaches ChatQueue | Drain includes accepted work still in pre-queue preparation. [handlers.test.ts](../src/telegram/__tests__/handlers.test.ts) | Direct deferred-storage plus queued-generation drain regression. |
| 22 | `loop/client.test.ts` — Second model text block disappears | All text blocks are included in the returned response. [attempt-usage.test.ts](../src/agent/__tests__/attempt-usage.test.ts) | Direct regression. |
| 23 | `loop/client.test.ts` — Aborted output is persisted as assistant conversation | Aborted output is diagnostic audit and omitted from conversation. [conversation-projection.test.ts](../src/agent/__tests__/conversation-projection.test.ts) | Direct real-client regression with a fake model response. |
| 24 | `pipeline/scheduled-repros.test.ts` — Scheduled silent token is sent | Scheduled delivery suppresses silent control text. [correction-contracts.test.ts](../src/agent/__tests__/correction-contracts.test.ts) | Direct scheduler/runtime delivery regression. |
| 25 | `pipeline/scheduled-repros.test.ts` — Scheduled answer duplicates text already sent to Saved Messages | Exact delivery evidence at the actual destination avoids resend. [correction-contracts.test.ts](../src/agent/__tests__/correction-contracts.test.ts) | Direct scheduler/runtime destination-deduplication regression. |
| 26 | `pipeline/scheduled-repros.test.ts` — Iteration budget is treated as task completion | Incomplete runtime outcome remains incomplete in task history. [scheduled-task-authorization.test.ts](../src/telegram/__tests__/scheduled-task-authorization.test.ts) | Direct outcome-mapping regression. |
| 27 | `loop/hotreload.test.ts` — Reload closes active DB and publishes before start finishes | Old executor drains before close; candidate stays unpublished until ready. [plugin-watcher.test.ts](../src/agent/tools/__tests__/plugin-watcher.test.ts) | Direct controlled module/SQLite regression. |
| 28 | `loop/hotreload.test.ts` — Failed candidate rollback cannot repair active old DB | Active old work finishes first, then failed candidate rollback safely reopens old generation. [plugin-watcher.test.ts](../src/agent/tools/__tests__/plugin-watcher.test.ts) | Direct failed-start variant. |
| 29 | `pipeline/pending-history-repro.test.ts` — Unmentioned message is erased by end-of-turn clear | Arrivals during active generation remain available for the next turn. [handler-ingress-replay.test.ts](../src/telegram/__tests__/handler-ingress-replay.test.ts) | Real pipeline/debouncer/handler; sentinel appears exactly once in the next turn. |
| 30 | `loop/loop.test.ts` — Retry-After 60s outlives a 10s turn | Recovery refuses the backoff immediately with a budget outcome. [overflow-recovery.test.ts](../src/agent/loop/__tests__/overflow-recovery.test.ts) | Direct recovery regression. |
| 31 | `loop/loop.test.ts` — Overflow after an action erases its receipt | Same-session recovery retains exact receipt and earlier user limits. [overflow-recovery.test.ts](../src/agent/loop/__tests__/overflow-recovery.test.ts) | Direct compaction/recovery regression. |
| 32 | `loop/loop.test.ts` — Aborted text-only generation becomes completed | The loop reports interruption with no accumulated final text. [executor-deadline.test.ts](../src/agent/loop/__tests__/executor-deadline.test.ts) | Direct no-tool regression. |
| 33 | `loop/loop.test.ts` — Aborted partial tool call executes | No executor or action reservation starts from aborted generation. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Runtime/registry integration regression with a fake model. |
| 34 | `loop/loop.test.ts` — Model consumes deadline then starts an external tool | Late response cannot start an action and outcome is incomplete. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Runtime integration regression. |
| 35 | `loop/loop.test.ts` — Last iteration performs action and must retain budget status/result | One action result is retained and the turn remains incomplete. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct last-iteration action receipt plus blocked dependent regression. |
| 36 | `loop/loop.test.ts` — Terminal error loses known usage before trace persistence | Attempt, trace and usage projections keep known terminal counters. [harness-integration.test.ts](../src/agent/__tests__/harness-integration.test.ts) | Direct integration regression, including late and cache-only usage. |

The original review artifact, `teleton-agent-review/rapport.md` with its adjacent `reproductions/` and `logs/`, is stored outside this repository. It contains 36 original reproduction tests in 11 files and the SDK abort fixture. Those reproductions observed pre-fix behavior; they are not part of the default repository suite, and a passing original reproduction is not proof of a fix. Keep the artifact with the review records when transferring the work.

Run repository regressions with `npm test -- --maxWorkers=2`, then `npm run typecheck`, `npm run typecheck:test` and `npm run lint`. These tests use controlled providers/senders and SQLite fixtures. They do not establish production throughput, power-loss durability, distributed exactly-once execution, live multimodal quality or real external side-effect recovery.
