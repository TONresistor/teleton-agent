import { Type } from "@sinclair/typebox";
import type {
  RichMessageMediaType,
  RichMessageMediaUpload,
} from "../../../../telegram/bridge-interface.js";
import type { Tool, ToolExecutor, ToolResult } from "../../types.js";
import { TELEGRAM_MAX_MESSAGE_LENGTH } from "../../../../constants/limits.js";
import {
  ALLOWED_EXTENSIONS,
  validateFileSize,
  validateReadPath,
  WorkspaceSecurityError,
} from "../../../../workspace/index.js";
import { getErrorMessage } from "../../../../utils/errors.js";
import { createLogger } from "../../../../utils/logger.js";

const log = createLogger("Tools");
const RICH_MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RICH_MEDIA_REFERENCE =
  /(?<!\\)!\[(?:\\.|[^\]\\\r\n])*\]\(tg:\/\/(photo|video|audio)\?id=([A-Za-z0-9_-]{1,64})\)/g;
const RICH_MEDIA_URI = /tg:\/\/(?:photo|video|audio)\b/i;
const MAX_RICH_MEDIA_FILES = 50;

const ALLOWED_EXTENSIONS_BY_TYPE: Record<RichMessageMediaType, readonly string[]> = {
  photo: ALLOWED_EXTENSIONS.images.filter((extension) => extension !== ".gif"),
  video: ALLOWED_EXTENSIONS.video,
  audio: ALLOWED_EXTENSIONS.audio,
};

const FILE_SIZE_TYPE: Record<RichMessageMediaType, "image" | "video" | "audio"> = {
  photo: "image",
  video: "video",
  audio: "audio",
};

interface SendRichMessageParams {
  chatId: string;
  text: string;
  media: Array<{
    id: string;
    type: RichMessageMediaType;
    path: string;
  }>;
  replyToId?: number;
}

export const telegramSendRichMessageTool: Tool = {
  name: "telegram_send_rich_message",
  description:
    "Upload local workspace photos, videos, or audio and place them between text blocks in a single Rich Message. Reference each media ID in Rich Markdown, for example: Before\\n\\n![Chart](tg://photo?id=chart)\\n\\nAfter. Use tg://video?id= and tg://audio?id= for those types.",
  category: "action",
  parameters: Type.Object({
    chatId: Type.String({
      description: "The destination Telegram chat ID",
    }),
    text: Type.String({
      description:
        "Rich Markdown containing one matching tg://photo?id=, tg://video?id=, or tg://audio?id= reference for every uploaded media item",
      maxLength: TELEGRAM_MAX_MESSAGE_LENGTH,
    }),
    media: Type.Array(
      Type.Object({
        id: Type.String({
          description:
            "Unique media ID used by the matching tg://... reference (1-64 letters, digits, underscores, or hyphens)",
          minLength: 1,
          maxLength: 64,
        }),
        type: Type.Union([Type.Literal("photo"), Type.Literal("video"), Type.Literal("audio")], {
          description: "Media block type; it must match the tg:// reference and file extension",
        }),
        path: Type.String({
          description:
            "Local media path inside the Teleton workspace, normally uploads/, downloads/, temp/, or memes/",
        }),
      }),
      {
        minItems: 1,
        maxItems: MAX_RICH_MEDIA_FILES,
      }
    ),
    replyToId: Type.Optional(
      Type.Number({
        description: "Optional message ID to reply to",
      })
    ),
  }),
};

function stripMarkdownCode(text: string): string {
  const lines = text.split("\n");
  const visibleLines: string[] = [];
  let fence: { character: "`" | "~"; length: number } | null = null;

  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim().length === 0
      ) {
        fence = null;
      }
      visibleLines.push("");
      continue;
    }

    if (fenceMatch) {
      fence = {
        character: fenceMatch[1][0] as "`" | "~",
        length: fenceMatch[1].length,
      };
      visibleLines.push("");
      continue;
    }

    visibleLines.push(line);
  }

  const visibleText = visibleLines.join("\n");
  let result = "";
  let cursor = 0;

  while (cursor < visibleText.length) {
    if (visibleText[cursor] !== "`") {
      result += visibleText[cursor];
      cursor += 1;
      continue;
    }

    let openingEnd = cursor;
    while (visibleText[openingEnd] === "`") openingEnd += 1;
    const delimiterLength = openingEnd - cursor;
    let closingStart = -1;
    let searchCursor = openingEnd;

    while (searchCursor < visibleText.length) {
      if (visibleText[searchCursor] !== "`") {
        searchCursor += 1;
        continue;
      }

      let runEnd = searchCursor;
      while (visibleText[runEnd] === "`") runEnd += 1;
      if (runEnd - searchCursor === delimiterLength) {
        closingStart = searchCursor;
        break;
      }
      searchCursor = runEnd;
    }

    if (closingStart === -1) {
      result += visibleText.slice(cursor, openingEnd);
      cursor = openingEnd;
      continue;
    }

    const closingEnd = closingStart + delimiterLength;
    result += visibleText.slice(cursor, closingEnd).replace(/[^\n]/g, " ");
    cursor = closingEnd;
  }

  return result;
}

function collectReferences(text: string): Map<string, RichMessageMediaType> | string {
  const visibleText = stripMarkdownCode(text);
  const references = new Map<string, RichMessageMediaType>();
  for (const match of visibleText.matchAll(RICH_MEDIA_REFERENCE)) {
    const type = match[1] as RichMessageMediaType;
    const id = match[2];
    const previousType = references.get(id);
    if (previousType && previousType !== type) {
      return `Media ID "${id}" is referenced with more than one type`;
    }
    references.set(id, type);
  }

  if (RICH_MEDIA_URI.test(visibleText.replace(RICH_MEDIA_REFERENCE, ""))) {
    return (
      "Invalid Rich Markdown media reference. Use exactly " +
      "![label](tg://photo?id=media_ID), with a complete 1-64 character ID."
    );
  }

  return references;
}

function validateMediaDefinitions(
  text: string,
  media: SendRichMessageParams["media"]
): { ok: true; references: Map<string, RichMessageMediaType> } | { ok: false; error: string } {
  const definitions = new Map<string, RichMessageMediaType>();
  for (const item of media) {
    if (!RICH_MEDIA_ID.test(item.id)) {
      return {
        ok: false,
        error: `Invalid media ID "${item.id}". Use 1-64 letters, digits, underscores, or hyphens.`,
      };
    }
    if (definitions.has(item.id)) {
      return { ok: false, error: `Media IDs must be unique; "${item.id}" is duplicated.` };
    }
    definitions.set(item.id, item.type);
  }

  const references = collectReferences(text);
  if (typeof references === "string") return { ok: false, error: references };

  for (const [id, type] of references) {
    const definedType = definitions.get(id);
    if (!definedType) {
      return { ok: false, error: `Rich Markdown reference "${id}" has no matching upload.` };
    }
    if (definedType !== type) {
      return {
        ok: false,
        error: `Media "${id}" has type "${definedType}" but its Rich Markdown reference uses type "${type}".`,
      };
    }
  }

  for (const item of media) {
    if (!references.has(item.id)) {
      return {
        ok: false,
        error: `Media "${item.id}" is not referenced in the Rich Markdown text.`,
      };
    }
  }

  return { ok: true, references };
}

export const telegramSendRichMessageExecutor: ToolExecutor<SendRichMessageParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    if (!context.bridge.sendRichMessage) {
      return {
        success: false,
        error: "Rich Messages with uploaded media require Telegram user mode.",
      };
    }

    const validation = validateMediaDefinitions(params.text, params.media);
    if (!validation.ok) return { success: false, error: validation.error };

    const uploads: RichMessageMediaUpload[] = [];
    for (const item of params.media) {
      let validatedPath;
      try {
        validatedPath = validateReadPath(item.path);
      } catch (error) {
        if (error instanceof WorkspaceSecurityError) {
          return {
            success: false,
            error: `Security Error: ${error.message}. Media must be inside the Teleton workspace.`,
          };
        }
        throw error;
      }

      if (!ALLOWED_EXTENSIONS_BY_TYPE[item.type].includes(validatedPath.extension)) {
        return {
          success: false,
          error:
            `Invalid extension "${validatedPath.extension}" for ${item.type} media. ` +
            `Allowed: ${ALLOWED_EXTENSIONS_BY_TYPE[item.type].join(", ")}.`,
        };
      }
      validateFileSize(validatedPath.absolutePath, FILE_SIZE_TYPE[item.type]);
      uploads.push({
        id: item.id,
        type: item.type,
        path: validatedPath.absolutePath,
      });
    }

    const sent = await context.bridge.sendRichMessage({
      chatId: params.chatId,
      text: params.text,
      media: uploads,
      replyToId: params.replyToId,
    });

    return {
      success: true,
      data: {
        messageId: sent.id,
        date: sent.date,
        mediaCount: uploads.length,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error sending Rich Message with uploaded media");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
