import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { Api } from "telegram";
import { randomLong } from "../../../../utils/gramjs-bigint.js";
import { MAX_DEPENDENTS_PER_TASK } from "../../../../constants/limits.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";
import { getClient } from "../../../../sdk/telegram-utils.js";

const log = createLogger("Tools");

/**
 * Parameters for telegram_create_scheduled_task tool
 */
interface CreateScheduledTaskParams {
  description: string;
  scheduleDate?: string;
  scheduleInSeconds?: number;
  repeatEverySeconds?: number;
  payload?: string;
  reason?: string;
  priority?: number;
  dependsOn?: string[];
}

/**
 * Tool definition for creating scheduled tasks
 *
 * Examples:
 *
 * 1. Simple tool call (auto-executed):
 *    {
 *      description: "Check TON price",
 *      scheduleDate: "2024-12-25T10:00:00Z",
 *      payload: '{"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}',
 *      reason: "Monitor for trading opportunity"
 *    }
 *
 * 2. Complex agent task (multi-step):
 *    {
 *      description: "Trade if conditions met",
 *      scheduleDate: "2024-12-25T15:00:00Z",
 *      payload: '{"type":"agent_task","instructions":"1. Check TON price\\n2. If > $5, swap 50 TON to USDT","context":{"maxAmount":50}}',
 *      reason: "Automated trading strategy"
 *    }
 *
 * 3. Simple reminder (no payload):
 *    {
 *      description: "Review trading performance this week",
 *      scheduleDate: "2024-12-31T18:00:00Z",
 *      reason: "Weekly review"
 *    }
 */
export const telegramCreateScheduledTaskTool: Tool = {
  name: "telegram_create_scheduled_task",
  description:
    "Create an automatic reminder/task that FIRES AT A SPECIFIED TIME: at the scheduled moment the agent will automatically execute the task or send a Telegram message to the owner — no manual action needed. Use for 'remind me at 21:00', 'send a message tomorrow 09:00', 'check price in 1 hour', recurring schedules. Русский: создать напоминание, таймер, отложенное сообщение, запланировать задачу, повторить через. Supports tool_call payload (auto-execute a tool), agent_task payload (multi-step), or a simple reminder (message to owner).\n\nAMBIGUOUS TIME: if the user says something like 'в 10 минут' / 'at 10 minutes', it is ambiguous — it could mean a relative delay ('in 10 minutes') or an absolute time ('at 19:10' or 'at 10:10'). ASK the user which they mean before scheduling. Never guess.",
  parameters: Type.Object({
    description: Type.String({
      description: "What the task is about (e.g., 'Check TON price and alert if > $5')",
    }),
    scheduleInSeconds: Type.Optional(
      Type.Number({
        description:
          "PREFERRED for relative timing ('in 60 seconds', 'every minute', 'in 2 hours'): number of seconds from now until execution. Timezone-proof — the server computes the exact moment. Always use this for delays instead of scheduleDate.",
        minimum: 1,
      })
    ),
    scheduleDate: Type.Optional(
      Type.String({
        description:
          "Absolute execution time, ISO 8601 or natural language. ISO must be UTC ('Z' suffix) or carry an explicit offset (e.g. '+02:00'). Natural language supported: '21:00' (today), 'завтра 09:00' / 'tomorrow 09:00', 'через 2 часа' / 'in 2 hours', 'через 30 минут'. A phrase like 'в 10 минут' usually means a RELATIVE delay (in 10 minutes) → use scheduleInSeconds instead. Message timestamps are shown in LOCAL time, so do NOT copy the local wall-clock and append 'Z' — that shifts the task by your UTC offset. For relative delays prefer scheduleInSeconds. Optional if dependsOn is provided.",
      })
    ),
    repeatEverySeconds: Type.Optional(
      Type.Number({
        minimum: 60,
        description:
          "Repeat this task every N seconds after each successful execution (minimum 60).",
      })
    ),
    payload: Type.Optional(
      Type.String({
        description: `JSON payload defining task execution. Two types:

1. Simple tool call (auto-executed, result fed to you):
   {"type":"tool_call","tool":"ton_get_price","params":{},"condition":"price > 5"}

2. Complex agent task (you execute step-by-step):
   {"type":"agent_task","instructions":"1. Check price\\n2. If > $5, swap 50 TON","context":{"chatId":"123"}}

3. Skip on parent failure (continues even if parent fails):
   {"type":"agent_task","instructions":"Send daily report","skipOnParentFailure":false}

If omitted, task is a simple reminder.`,
      })
    ),
    reason: Type.Optional(
      Type.String({
        description: "Why you're scheduling this task (helps with context when executing)",
      })
    ),
    priority: Type.Optional(
      Type.Number({
        description: "Task priority (0-10, higher = more important)",
        minimum: 0,
        maximum: 10,
      })
    ),
    dependsOn: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Array of parent task IDs that must complete before this task executes. When dependencies are provided, task executes automatically when all parents are done (scheduleDate is ignored).",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_scheduled_task tool
 */
export const telegramCreateScheduledTaskExecutor: ToolExecutor<CreateScheduledTaskParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      description,
      scheduleDate,
      scheduleInSeconds,
      repeatEverySeconds,
      payload,
      reason,
      priority,
      dependsOn,
    } = params;

    // Validate: scheduleInSeconds, scheduleDate, OR dependsOn must be provided
    if (
      scheduleInSeconds === undefined &&
      !scheduleDate &&
      (!dependsOn || dependsOn.length === 0)
    ) {
      return {
        success: false,
        error: "One of scheduleInSeconds, scheduleDate, or dependsOn must be provided",
      };
    }
    if (
      repeatEverySeconds !== undefined &&
      (!Number.isFinite(repeatEverySeconds) || repeatEverySeconds < 60)
    ) {
      return { success: false, error: "repeatEverySeconds must be at least 60 seconds" };
    }

    // Resolve the schedule timestamp. Relative (scheduleInSeconds) is timezone-proof
    // and takes precedence over the absolute scheduleDate.
    let scheduleTimestamp: number | undefined;
    if (scheduleInSeconds !== undefined) {
      if (!Number.isFinite(scheduleInSeconds) || scheduleInSeconds < 1) {
        return { success: false, error: "scheduleInSeconds must be a positive number of seconds" };
      }
      scheduleTimestamp = Math.floor(Date.now() / 1000) + Math.floor(scheduleInSeconds);
    } else if (scheduleDate) {
      const parsedDate = new Date(scheduleDate);
      if (!isNaN(parsedDate.getTime())) {
        scheduleTimestamp = Math.floor(parsedDate.getTime() / 1000);
      } else {
        // Fall back to natural-language parsing (e.g. "21:00", "завтра 09:00", "через 2 часа")
        const { parseNaturalSchedule } = await import("../../../../utils/parse-natural-time.js");
        const naturalTs = parseNaturalSchedule(scheduleDate);
        if (naturalTs === null) {
          return {
            success: false,
            error: "Invalid scheduleDate format",
          };
        }
        scheduleTimestamp = naturalTs;
      }

      // Validate future date
      const now = Math.floor(Date.now() / 1000);
      if (scheduleTimestamp <= now) {
        return {
          success: false,
          error: "Schedule date must be in the future",
        };
      }
    }

    // Validate payload if provided
    if (payload) {
      try {
        const parsed = JSON.parse(payload);
        if (!parsed.type || !["tool_call", "agent_task"].includes(parsed.type)) {
          return {
            success: false,
            error: 'Payload must have type "tool_call" or "agent_task"',
          };
        }

        // Validate tool_call payload
        if (parsed.type === "tool_call") {
          if (!parsed.tool || typeof parsed.tool !== "string") {
            return {
              success: false,
              error: 'tool_call payload requires "tool" field (string)',
            };
          }
          if (parsed.params !== undefined && typeof parsed.params !== "object") {
            return {
              success: false,
              error: 'tool_call payload "params" must be an object',
            };
          }
          // Note: Tool existence is validated at execution time by the executor.
          // We can't easily validate here as tool registry isn't in ToolContext.
        }

        // Validate agent_task payload
        if (parsed.type === "agent_task") {
          if (!parsed.instructions || typeof parsed.instructions !== "string") {
            return {
              success: false,
              error: 'agent_task payload requires "instructions" field (string)',
            };
          }
          if (parsed.instructions.length < 5) {
            return {
              success: false,
              error: "Instructions too short (min 5 characters)",
            };
          }
          if (parsed.context !== undefined && typeof parsed.context !== "object") {
            return {
              success: false,
              error: 'agent_task payload "context" must be an object',
            };
          }
        }
      } catch {
        return {
          success: false,
          error: "Invalid JSON payload",
        };
      }
    }

    // 1. Create task in TaskStore
    if (!context.db) {
      return {
        success: false,
        error: "Database not available",
      };
    }

    const { getTaskStore } = await import("../../../../memory/agent/tasks.js");
    const taskStore = getTaskStore(context.db);

    // Security: Validate that adding this task won't exceed dependent limit for any parent
    if (dependsOn && dependsOn.length > 0) {
      for (const parentId of dependsOn) {
        const existingDependents = taskStore.getDependents(parentId);
        if (existingDependents.length >= MAX_DEPENDENTS_PER_TASK) {
          return {
            success: false,
            error: `Parent task ${parentId} already has ${existingDependents.length} dependents (max: ${MAX_DEPENDENTS_PER_TASK})`,
          };
        }
      }
    }

    const task = taskStore.createTask({
      description,
      priority: priority ?? 0,
      createdBy: `telegram:${context.senderId}`,
      scheduledFor: scheduleTimestamp ? new Date(scheduleTimestamp * 1000) : undefined,
      repeatEveryMs: repeatEverySeconds ? Math.floor(repeatEverySeconds * 1000) : undefined,
      payload,
      reason,
      originSenderId: context.senderId,
      originChatId: context.chatId,
      originIsGroup: context.isGroup,
      dependsOn,
    });

    // 2. Schedule Telegram message with [TASK:uuid] format (only if not dependent on other tasks)
    let scheduledMessageId: number | undefined;

    if (dependsOn && dependsOn.length > 0) {
      // Task has dependencies - will be triggered by parent completion
      return {
        success: true,
        data: {
          taskId: task.id,
          dependsOn,
          message: `Task created: "${description}" (will execute when ${dependsOn.length} parent task(s) complete)`,
        },
      };
    } else if (scheduleTimestamp && !repeatEverySeconds) {
      // Task has schedule date - schedule Telegram message
      const gramJsClient = getClient(context.bridge);

      // Get "me" entity for Saved Messages
      const me = await gramJsClient.getMe();

      const taskMessage = `[TASK:${task.id}] ${description}`;

      const result = await gramJsClient.invoke(
        new Api.messages.SendMessage({
          peer: me,
          message: taskMessage,
          scheduleDate: scheduleTimestamp,
          randomId: randomLong(),
        })
      );

      // Extract scheduled message ID
      if (result instanceof Api.Updates || result instanceof Api.UpdatesCombined) {
        for (const update of result.updates) {
          if (update instanceof Api.UpdateMessageID) {
            scheduledMessageId = update.id;
            break;
          }
        }
      }

      return {
        success: true,
        data: {
          taskId: task.id,
          scheduledFor: new Date(scheduleTimestamp * 1000).toISOString(),
          scheduledMessageId,
          message: `Task scheduled: "${description}" at ${new Date(scheduleTimestamp * 1000).toLocaleString()}`,
        },
      };
    }

    if (scheduleTimestamp && repeatEverySeconds) {
      return {
        success: true,
        data: {
          taskId: task.id,
          scheduledFor: new Date(scheduleTimestamp * 1000).toISOString(),
          repeatEverySeconds,
          message:
            `Task scheduled for automatic execution at ${new Date(scheduleTimestamp * 1000).toISOString()} ` +
            `and repeat every ${repeatEverySeconds} seconds. The running Teleton scheduler will execute it; ` +
            "no manual action is required.",
        },
      };
    }

    // A dependency-only task is triggered by its parent completion.
    if (dependsOn && dependsOn.length > 0) {
      return {
        success: true,
        data: {
          taskId: task.id,
          dependsOn,
          message: "Task saved and waiting for its parent task(s).",
        },
      };
    }

    return {
      success: false,
      error: "Invalid state: no scheduleDate or dependsOn",
    };
  } catch (error) {
    log.error({ err: error }, "Error creating scheduled task");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
