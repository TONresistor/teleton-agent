import type { Task } from "../memory/agent/tasks.js";
import type { ToolContext } from "../agent/tools/types.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import type { ToolCall } from "@earendil-works/pi-ai";
import type { AgentRuntime } from "../agent/runtime.js";
import {
  MAX_JSON_FIELD_CHARS,
  MAX_TOTAL_PROMPT_CHARS,
  SECONDS_PER_DAY,
  SECONDS_PER_HOUR,
} from "../constants/limits.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Safely stringify and truncate JSON for prompt injection.
 * Returns truncated string with indicator if exceeds limit.
 */
function truncateJson(data: unknown, maxChars: number = MAX_JSON_FIELD_CHARS): string {
  try {
    const str = JSON.stringify(data, null, 2);
    if (str.length <= maxChars) {
      return str;
    }
    // Truncate with indicator
    return (
      str.slice(0, maxChars - 50) +
      "\n... [TRUNCATED - " +
      (str.length - maxChars + 50) +
      " chars omitted]"
    );
  } catch {
    return "[Error serializing data]";
  }
}

/**
 * Task payload types
 */
export type TaskPayload =
  | {
      type: "tool_call";
      tool: string;
      params: Record<string, unknown>;
      condition?: string;
      skipOnParentFailure?: boolean;
    }
  | {
      type: "agent_task";
      instructions: string;
      context?: Record<string, unknown>;
      skipOnParentFailure?: boolean;
    };

/**
 * Execute a scheduled task with agent-in-the-loop
 *
 * Two modes:
 * 1. tool_call: Auto-execute tool, then feed result to agent for decision
 * 2. agent_task: Full agent loop with multi-step reasoning
 *
 * @param parentResults - Results from parent tasks (if this task has dependencies)
 */
export async function executeScheduledTask(
  task: Task,
  agent: AgentRuntime,
  toolContext: ToolContext,
  toolRegistry: ToolRegistry,
  parentResults?: Array<{ taskId: string; description: string; result: unknown }>
): Promise<string> {
  if (!task.payload) {
    // No payload = simple reminder, just notify agent
    return buildAgentPrompt(task, null, parentResults);
  }

  const payload: TaskPayload = JSON.parse(task.payload);

  if (payload.type === "tool_call") {
    // Mode 1: Auto-execute tool, feed result to agent
    try {
      // Scheduled direct calls are limited to read-only tools. Actions must run
      // through an agent turn (and their normal approval/authorization gates).
      if (toolRegistry.getToolCategory(payload.tool) !== "data-bearing") {
        return buildAgentPrompt(
          task,
          {
            toolExecuted: payload.tool,
            toolParams: payload.params ?? {},
            toolError: `Refused scheduled action tool "${payload.tool}"; only data-bearing tools can auto-execute.`,
          },
          parentResults
        );
      }

      const toolCall: ToolCall = {
        type: "toolCall",
        id: `scheduled-${task.id}`,
        name: payload.tool,
        arguments: payload.params ?? {},
      };
      const result = await toolRegistry.execute(toolCall, toolContext);

      // Build prompt with task context + tool result
      return buildAgentPrompt(
        task,
        {
          toolExecuted: payload.tool,
          toolParams: payload.params,
          toolResult: result,
          condition: payload.condition,
        },
        parentResults
      );
    } catch (error) {
      // Tool failed, notify agent
      return buildAgentPrompt(
        task,
        {
          toolExecuted: payload.tool,
          toolParams: payload.params,
          toolError: getErrorMessage(error),
        },
        parentResults
      );
    }
  } else if (payload.type === "agent_task") {
    // Mode 2: Full agent loop (instructions only)
    return buildAgentPrompt(
      task,
      {
        instructions: payload.instructions,
        context: payload.context,
      },
      parentResults
    );
  }

  return buildAgentPrompt(task, null, parentResults);
}

type ExecutionData =
  | null
  | {
      toolExecuted: string;
      toolParams: Record<string, unknown>;
      toolResult: unknown;
      condition?: string;
    }
  | { toolExecuted: string; toolParams: Record<string, unknown>; toolError: string }
  | { instructions: string; context?: Record<string, unknown> };

/**
 * Build prompt for agent with task context
 */
function buildAgentPrompt(
  task: Task,
  executionData: ExecutionData,
  parentResults?: Array<{ taskId: string; description: string; result: unknown }>
): string {
  const timeAgo = formatTimeAgo(task.createdAt);

  let prompt = `[SCHEDULED TASK - ${task.id}]\n`;
  prompt += `Description: ${task.description}\n`;

  if (task.reason) {
    prompt += `Reason: ${task.reason}\n`;
  }

  prompt += `Scheduled: ${timeAgo}\n`;

  // Add parent task results if this is a dependent task
  if (parentResults && parentResults.length > 0) {
    prompt += `\n`;
    prompt += `PARENT TASK${parentResults.length > 1 ? "S" : ""} COMPLETED:\n`;
    // Limit chars per parent based on count to stay within total budget
    const charsPerParent = Math.min(
      MAX_JSON_FIELD_CHARS,
      Math.floor(MAX_JSON_FIELD_CHARS / parentResults.length)
    );
    for (const parent of parentResults) {
      prompt += `\n• Task: ${parent.description}\n`;
      prompt += `  Result: ${truncateJson(parent.result, charsPerParent)}\n`;
    }
  }

  prompt += `\n`;

  if (!executionData) {
    // Simple reminder
    prompt += `This is a reminder you scheduled for yourself.\n`;
    return prompt;
  }

  if ("toolExecuted" in executionData) {
    // Tool was executed
    prompt += `TOOL EXECUTED:\n`;
    prompt += `• Name: ${executionData.toolExecuted}\n`;
    prompt += `• Params: ${truncateJson(executionData.toolParams, 2000)}\n`;
    prompt += `\n`;

    if ("toolError" in executionData) {
      prompt += `❌ ERROR:\n${executionData.toolError}\n\n`;
      prompt += `→ The tool failed. Decide how to handle this error.\n`;
    } else {
      prompt += `✅ RESULT:\n${truncateJson(executionData.toolResult)}\n\n`;

      if (executionData.condition) {
        prompt += `Condition: ${executionData.condition}\n`;
      }

      prompt += `→ Analyze this result and decide what action to take.\n`;
    }
  } else if ("instructions" in executionData) {
    // Agent task
    prompt += `INSTRUCTIONS:\n${executionData.instructions}\n\n`;

    if (executionData.context) {
      prompt += `Context: ${truncateJson(executionData.context, 4000)}\n\n`;
    }

    prompt += `→ Execute these instructions step by step using available tools.\n`;
  }

  // Final safety check: truncate entire prompt if too large
  if (prompt.length > MAX_TOTAL_PROMPT_CHARS) {
    prompt =
      prompt.slice(0, MAX_TOTAL_PROMPT_CHARS - 100) +
      "\n\n... [PROMPT TRUNCATED - " +
      (prompt.length - MAX_TOTAL_PROMPT_CHARS + 100) +
      " chars omitted]";
  }

  return prompt;
}

/**
 * Format time ago (e.g., "2 hours ago")
 */
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds} seconds ago`;
  if (seconds < SECONDS_PER_HOUR) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < SECONDS_PER_DAY) return `${Math.floor(seconds / SECONDS_PER_HOUR)} hours ago`;
  return `${Math.floor(seconds / SECONDS_PER_DAY)} days ago`;
}
