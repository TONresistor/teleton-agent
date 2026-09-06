import { Type } from "@sinclair/typebox";
import type {
  RichMessageContent,
  RichMessageMediaType,
} from "../../../../telegram/bridge-interface.js";
import {
  RICH_MESSAGE_MAX_ATTACHMENTS,
  RICH_MESSAGE_MAX_BLOCKS,
  RICH_MESSAGE_MAX_BUTTONS_PER_ROW,
  RICH_MESSAGE_MAX_BYTES,
  RICH_MESSAGE_MAX_TABLE_COLUMNS,
} from "../../../../telegram/outgoing-rich-message.js";
import {
  ALLOWED_EXTENSIONS,
  validateFileSize,
  validateReadPath,
  WorkspaceSecurityError,
} from "../../../../workspace/index.js";
import type { ToolContext } from "../../types.js";

const buttonStyleSchema = Type.Union([
  Type.Literal("primary"),
  Type.Literal("success"),
  Type.Literal("danger"),
  Type.Literal("link"),
]);

const buttonFields = {
  label: Type.String({ minLength: 1, maxLength: 256 }),
  action: Type.Union([
    Type.Object(
      {
        type: Type.Literal("url"),
        url: Type.String({ minLength: 1, maxLength: 2048 }),
      },
      { additionalProperties: false }
    ),
    Type.Object(
      {
        type: Type.Literal("copy"),
        text: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false }
    ),
  ]),
  style: Type.Optional(buttonStyleSchema),
};

const buttonSchema = Type.Object(buttonFields, { additionalProperties: false });

const inlineItemSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("text"),
      text: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("button"),
      ...buttonFields,
    },
    { additionalProperties: false }
  ),
]);

const buttonRowFields = {
  align: Type.Optional(
    Type.Union([Type.Literal("left"), Type.Literal("center"), Type.Literal("right")])
  ),
  buttons: Type.Array(buttonSchema, {
    minItems: 1,
    maxItems: RICH_MESSAGE_MAX_BUTTONS_PER_ROW,
  }),
};

const buttonRowSchema = Type.Object(buttonRowFields, { additionalProperties: false });

const listItemSchema = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
    checked: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false }
);

const richBlockSchema = Type.Union([
  Type.Object(
    {
      type: Type.Literal("paragraph"),
      markdown: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("inline"),
      items: Type.Array(inlineItemSchema, {
        minItems: 1,
        maxItems: RICH_MESSAGE_MAX_BLOCKS,
      }),
    },
    {
      additionalProperties: false,
      description:
        "One paragraph mixing plain text and small inline URL/copy buttons in exact order. Use link style for a subtle text-like button.",
    }
  ),
  Type.Object(
    {
      type: Type.Literal("heading"),
      text: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
      level: Type.Optional(Type.Integer({ minimum: 1, maximum: 6 })),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("quote"),
      text: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
      caption: Type.Optional(Type.String({ maxLength: 1024 })),
      collapsed: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("code"),
      code: Type.String({ maxLength: RICH_MESSAGE_MAX_BYTES }),
      language: Type.Optional(Type.String({ maxLength: 64 })),
    },
    { additionalProperties: false }
  ),
  Type.Object({ type: Type.Literal("divider") }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal("list"),
      ordered: Type.Optional(Type.Boolean()),
      items: Type.Array(listItemSchema, { minItems: 1, maxItems: RICH_MESSAGE_MAX_BLOCKS }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("table"),
      rows: Type.Array(
        Type.Array(Type.String({ maxLength: RICH_MESSAGE_MAX_BYTES }), {
          minItems: 1,
          maxItems: RICH_MESSAGE_MAX_TABLE_COLUMNS,
        }),
        { minItems: 1, maxItems: RICH_MESSAGE_MAX_BLOCKS }
      ),
      caption: Type.Optional(Type.String({ maxLength: 1024 })),
      headerRow: Type.Optional(Type.Boolean()),
      bordered: Type.Optional(Type.Boolean()),
      striped: Type.Optional(Type.Boolean()),
      compact: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("details"),
      summary: Type.String({ minLength: 1, maxLength: 1024 }),
      markdown: Type.String({ minLength: 1, maxLength: RICH_MESSAGE_MAX_BYTES }),
      open: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("attachment"),
      id: Type.String({ minLength: 1, maxLength: 64 }),
    },
    { additionalProperties: false }
  ),
  Type.Object(
    {
      type: Type.Literal("buttonRow"),
      ...buttonRowFields,
    },
    { additionalProperties: false }
  ),
]);

export const richMessageContentSchema = Type.Object(
  {
    attachments: Type.Optional(
      Type.Array(
        Type.Object(
          {
            id: Type.String({ minLength: 1, maxLength: 64 }),
            type: Type.Union([
              Type.Literal("photo"),
              Type.Literal("video"),
              Type.Literal("audio"),
              Type.Literal("document"),
            ]),
            path: Type.String({ minLength: 1 }),
            caption: Type.Optional(Type.String({ maxLength: 1024 })),
          },
          { additionalProperties: false }
        ),
        { maxItems: RICH_MESSAGE_MAX_ATTACHMENTS }
      )
    ),
    buttonRows: Type.Optional(Type.Array(buttonRowSchema, { maxItems: RICH_MESSAGE_MAX_BLOCKS })),
    blocks: Type.Optional(Type.Array(richBlockSchema, { maxItems: RICH_MESSAGE_MAX_BLOCKS })),
    rtl: Type.Optional(Type.Boolean()),
    disableAutoLinks: Type.Optional(Type.Boolean()),
  },
  {
    additionalProperties: false,
    description:
      "Optional native Rich Message structure. Without blocks, text is followed by attachments and button rows. With blocks, blocks control the complete order.",
  }
);

const ALLOWED_EXTENSIONS_BY_TYPE: Record<RichMessageMediaType, readonly string[]> = {
  photo: ALLOWED_EXTENSIONS.images.filter((extension) => extension !== ".gif"),
  video: ALLOWED_EXTENSIONS.video,
  audio: ALLOWED_EXTENSIONS.audio,
  document: ALLOWED_EXTENSIONS.documents,
};

const FILE_SIZE_TYPE: Record<RichMessageMediaType, "image" | "video" | "audio" | "document"> = {
  photo: "image",
  video: "video",
  audio: "audio",
  document: "document",
};

export function prepareRichMessageContent(
  rich: RichMessageContent | undefined,
  context: ToolContext
): RichMessageContent | undefined {
  if (!rich) return undefined;
  if (context.bridge.getMode() !== "user") {
    throw new Error("Native Rich Messages require Telegram user mode");
  }

  const attachments = rich.attachments ?? [];
  if (attachments.length === 0) return rich;

  const isAdmin = context.config?.telegram.admin_ids.includes(context.senderId) ?? false;
  if (!isAdmin) {
    throw new Error("Local Rich Message attachments are restricted to administrators");
  }

  return {
    ...rich,
    attachments: attachments.map((attachment) => {
      let validatedPath;
      try {
        validatedPath = validateReadPath(attachment.path);
      } catch (error) {
        if (error instanceof WorkspaceSecurityError) {
          throw new Error(
            `Security Error: ${error.message}. Attachments must be inside the Teleton workspace.`
          );
        }
        throw error;
      }

      if (!ALLOWED_EXTENSIONS_BY_TYPE[attachment.type].includes(validatedPath.extension)) {
        throw new Error(
          `Invalid extension "${validatedPath.extension}" for ${attachment.type}. Allowed: ${ALLOWED_EXTENSIONS_BY_TYPE[attachment.type].join(", ")}.`
        );
      }
      validateFileSize(validatedPath.absolutePath, FILE_SIZE_TYPE[attachment.type]);
      return { ...attachment, path: validatedPath.absolutePath };
    }),
  };
}
