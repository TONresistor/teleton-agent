import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { MAX_POLL_QUESTION_LENGTH } from "../../../../constants/limits.js";

/**
 * Parameters for telegram_create_poll tool
 */
interface CreatePollParams {
  chatId: string;
  question: string;
  options: string[];
  anonymous?: boolean;
  multipleChoice?: boolean;
  publicVoters?: boolean;
  closePeriod?: number;
  closeDate?: number;
}

/**
 * Tool definition for creating polls
 */
export const telegramCreatePollTool: Tool = {
  name: "telegram_create_poll",
  description:
    "Create a poll in a Telegram chat to gather opinions or votes from users. Polls can be anonymous or public, allow single or multiple answers. Use this to make group decisions, conduct surveys, or engage users with questions. For quizzes with correct answers, use telegram_create_quiz instead.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the poll will be created",
    }),
    question: Type.String({
      description: `The poll question/prompt (max ${MAX_POLL_QUESTION_LENGTH} characters)`,
      maxLength: MAX_POLL_QUESTION_LENGTH,
    }),
    options: Type.Array(
      Type.String({
        description: "Answer option (max 100 characters)",
        maxLength: 100,
      }),
      {
        description:
          "Array of answer options (2-10 options, each max 100 characters). Example: ['Yes', 'No', 'Maybe']",
        minItems: 2,
        maxItems: 10,
      }
    ),
    anonymous: Type.Optional(
      Type.Boolean({
        description:
          "Whether votes are anonymous (voters not visible). Default: true. Set to false for public polls.",
      })
    ),
    multipleChoice: Type.Optional(
      Type.Boolean({
        description: "Allow users to select multiple answers. Default: false (single choice only).",
      })
    ),
    publicVoters: Type.Optional(
      Type.Boolean({
        description:
          "Show who voted for what (only for non-anonymous polls). Default: false. Requires anonymous=false.",
      })
    ),
    closePeriod: Type.Optional(
      Type.Number({
        description:
          "Auto-close poll after N seconds (5-600). Cannot be used with closeDate. Example: 300 for 5 minutes.",
      })
    ),
    closeDate: Type.Optional(
      Type.Number({
        description:
          "Unix timestamp when poll should close. Cannot be used with closePeriod. Example: 1735689600 for a specific date/time.",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_poll tool
 */
export const telegramCreatePollExecutor: ToolExecutor<CreatePollParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const {
      chatId,
      question,
      options,
      anonymous = true,
      multipleChoice = false,
      publicVoters = false,
      closePeriod,
      closeDate,
    } = params;

    if (options.length < 2 || options.length > 10) {
      return {
        success: false,
        error: "Poll must have between 2 and 10 options",
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Create poll using GramJS
    const poll = new Api.Poll({
      id: BigInt(Math.floor(Math.random() * 1e16)) as any,
      question: new Api.TextWithEntities({ text: question, entities: [] }),
      answers: options.map(
        (opt, idx) =>
          new Api.PollAnswer({
            text: new Api.TextWithEntities({ text: opt, entities: [] }),
            option: Buffer.from([idx]),
          })
      ),
      publicVoters: !anonymous && publicVoters,
      multipleChoice,
      closePeriod,
      closeDate,
    });

    const result = await gramJsClient.invoke(
      new Api.messages.SendMedia({
        peer: chatId,
        media: new Api.InputMediaPoll({
          poll,
        }),
        message: "",
        randomId: BigInt(Math.floor(Math.random() * 1e16)) as any,
      })
    );

    return {
      success: true,
      data: {
        pollId: poll.id.toString(),
        question,
        optionCount: options.length,
      },
    };
  } catch (error) {
    console.error("Error creating poll:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
