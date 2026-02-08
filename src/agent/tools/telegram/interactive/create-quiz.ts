import { Type } from "@sinclair/typebox";
import { Api } from "telegram";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";

/**
 * Parameters for telegram_create_quiz tool
 */
interface CreateQuizParams {
  chatId: string;
  question: string;
  options: string[];
  correctOptionIndex: number;
  explanation?: string;
  closePeriod?: number;
  closeDate?: number;
}

/**
 * Tool definition for creating quizzes
 */
export const telegramCreateQuizTool: Tool = {
  name: "telegram_create_quiz",
  description:
    "Create a quiz (poll with a correct answer) in a Telegram chat. Unlike regular polls, quizzes have one correct answer that gets revealed when users vote. Optionally add an explanation. Use this for educational content, trivia games, or testing knowledge. For opinion polls without correct answers, use telegram_create_poll instead.",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The chat ID where the quiz will be created",
    }),
    question: Type.String({
      description: "The quiz question (max 300 characters)",
      maxLength: 300,
    }),
    options: Type.Array(
      Type.String({
        description: "Answer option (max 100 characters)",
        maxLength: 100,
      }),
      {
        description:
          "Array of answer options (2-10 options, each max 100 characters). One will be marked as correct.",
        minItems: 2,
        maxItems: 10,
      }
    ),
    correctOptionIndex: Type.Number({
      description:
        "Zero-based index of the correct answer in the options array. Example: 0 for first option, 1 for second, etc.",
      minimum: 0,
    }),
    explanation: Type.Optional(
      Type.String({
        description:
          "Explanation text shown after user answers (max 200 characters). Use this to teach or provide context about the correct answer.",
        maxLength: 200,
      })
    ),
    closePeriod: Type.Optional(
      Type.Number({
        description:
          "Auto-close quiz after N seconds (5-600). Cannot be used with closeDate. Example: 300 for 5 minutes.",
      })
    ),
    closeDate: Type.Optional(
      Type.Number({
        description: "Unix timestamp when quiz should close. Cannot be used with closePeriod.",
      })
    ),
  }),
};

/**
 * Executor for telegram_create_quiz tool
 */
export const telegramCreateQuizExecutor: ToolExecutor<CreateQuizParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { chatId, question, options, correctOptionIndex, explanation, closePeriod, closeDate } =
      params;

    if (options.length < 2 || options.length > 10) {
      return {
        success: false,
        error: "Quiz must have between 2 and 10 options",
      };
    }

    if (correctOptionIndex < 0 || correctOptionIndex >= options.length) {
      return {
        success: false,
        error: `correctOptionIndex must be between 0 and ${options.length - 1}`,
      };
    }

    // Get underlying GramJS client
    const gramJsClient = context.bridge.getClient().getClient();

    // Create quiz poll with correct answer
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
      quiz: true, // Mark as quiz
      publicVoters: false, // Quizzes are always anonymous
      multipleChoice: false, // Quizzes only allow one answer
      closePeriod,
      closeDate,
    });

    const result = await gramJsClient.invoke(
      new Api.messages.SendMedia({
        peer: chatId,
        media: new Api.InputMediaPoll({
          poll,
          correctAnswers: [Buffer.from([correctOptionIndex])],
          solution: explanation,
          solutionEntities: [],
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
        correctOption: options[correctOptionIndex],
      },
    };
  } catch (error) {
    console.error("Error creating quiz:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
