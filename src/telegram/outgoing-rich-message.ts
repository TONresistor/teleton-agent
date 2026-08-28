import type {
  RichMessageBlock,
  RichMessageButton,
  RichMessageButtonRow,
  RichMessageContent,
  RichMessageMediaUpload,
} from "./bridge-interface.js";

export const RICH_MESSAGE_MAX_BYTES = 32_768;
export const RICH_MESSAGE_MAX_BLOCKS = 500;
export const RICH_MESSAGE_MAX_ATTACHMENTS = 50;
export const RICH_MESSAGE_MAX_TABLE_COLUMNS = 20;
export const RICH_MESSAGE_MAX_BUTTONS_PER_ROW = 8;

const RICH_MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/;
const RAW_MEDIA_REFERENCE = /tg:\/\/(?:photo|video|audio|document)\?id=/i;

export interface CompiledRichMessage {
  markdown: string;
  attachments: RichMessageMediaUpload[];
  rtl?: boolean;
  disableAutoLinks?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeMarkdownLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function escapeMarkdownTitle(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", " ");
}

function validateUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid Rich Message button URL: ${value}`);
  }
  if (!new Set(["https:", "http:", "tg:"]).has(url.protocol)) {
    throw new Error(`Unsupported Rich Message button URL protocol: ${url.protocol}`);
  }
}

function renderButton(button: RichMessageButton): string {
  if (!button.label.trim()) throw new Error("Rich Message button labels cannot be empty");
  const style = button.style ? ` style="${button.style}"` : "";
  if (button.action.type === "url") {
    validateUrl(button.action.url);
    return `<tg-button type="url"${style} url="${escapeHtml(button.action.url)}">${escapeHtml(button.label)}</tg-button>`;
  }
  if (!button.action.text || button.action.text.length > 256) {
    throw new Error("Rich Message copy button text must contain 1-256 characters");
  }
  return `<tg-button type="copy_text"${style} text="${escapeHtml(button.action.text)}">${escapeHtml(button.label)}</tg-button>`;
}

function renderButtonRow(row: RichMessageButtonRow): string {
  if (row.buttons.length < 1 || row.buttons.length > RICH_MESSAGE_MAX_BUTTONS_PER_ROW) {
    throw new Error("Rich Message button rows must contain 1-8 buttons");
  }
  const align = row.align ? ` align="${row.align}"` : "";
  return `<tg-button-row${align}>\n${row.buttons.map(renderButton).join("\n")}\n</tg-button-row>`;
}

function renderAttachment(attachment: RichMessageMediaUpload): string {
  const label = escapeMarkdownLabel(attachment.caption?.trim() || attachment.type);
  const title = attachment.caption?.trim()
    ? ` "${escapeMarkdownTitle(attachment.caption.trim())}"`
    : "";
  return `![${label}](tg://${attachment.type}?id=${attachment.id}${title})`;
}

function renderCode(code: string, language?: string): string {
  const longestFence = Math.max(0, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestFence + 1));
  return `${fence}${language ?? ""}\n${code}\n${fence}`;
}

function renderList(block: Extract<RichMessageBlock, { type: "list" }>): string {
  if (block.items.length === 0) throw new Error("Rich Message lists cannot be empty");
  return block.items
    .map((item, index) => {
      const marker = block.ordered ? `${index + 1}.` : "-";
      const checkbox = item.checked === undefined ? "" : ` [${item.checked ? "x" : " "}]`;
      return `${marker}${checkbox} ${item.text}`;
    })
    .join("\n");
}

function renderTable(block: Extract<RichMessageBlock, { type: "table" }>): string {
  if (block.rows.length === 0) throw new Error("Rich Message tables cannot be empty");
  const columnCount = Math.max(...block.rows.map((row) => row.length));
  if (columnCount < 1 || columnCount > RICH_MESSAGE_MAX_TABLE_COLUMNS) {
    throw new Error("Rich Message tables must contain 1-20 columns");
  }
  const attrs = [
    block.bordered ? "bordered" : "",
    block.striped ? "striped" : "",
    block.compact ? "compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const rows = block.rows
    .map((row, rowIndex) => {
      const cellTag = block.headerRow && rowIndex === 0 ? "th" : "td";
      const cells = Array.from({ length: columnCount }, (_, columnIndex) => {
        const value = row[columnIndex] ?? "";
        return `<${cellTag}>${escapeHtml(value).replaceAll("\n", "<br>")}</${cellTag}>`;
      }).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  const caption = block.caption ? `<caption>${escapeHtml(block.caption)}</caption>` : "";
  return `<table${attrs ? ` ${attrs}` : ""}>${caption}${rows}</table>`;
}

function renderQuote(block: Extract<RichMessageBlock, { type: "quote" }>): string {
  const caption = block.caption ? `<cite>${escapeHtml(block.caption)}</cite>` : "";
  if (block.collapsed) {
    return `<blockquote expandable>${escapeHtml(block.text).replaceAll("\n", "<br>")}${caption}</blockquote>`;
  }
  const quoted = block.text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return block.caption ? `${quoted}\n> — ${block.caption}` : quoted;
}

function renderBlock(
  block: RichMessageBlock,
  attachments: Map<string, RichMessageMediaUpload>,
  referencedAttachments: Set<string>
): string {
  switch (block.type) {
    case "paragraph":
      return block.markdown;
    case "heading": {
      const level = block.level ?? 2;
      if (!Number.isInteger(level) || level < 1 || level > 6) {
        throw new Error("Rich Message heading levels must be between 1 and 6");
      }
      return `${"#".repeat(level)} ${block.text}`;
    }
    case "quote":
      return renderQuote(block);
    case "code":
      return renderCode(block.code, block.language);
    case "divider":
      return "---";
    case "list":
      return renderList(block);
    case "table":
      return renderTable(block);
    case "details":
      return `<details${block.open ? " open" : ""}><summary>${escapeHtml(block.summary)}</summary>\n\n${block.markdown}\n\n</details>`;
    case "attachment": {
      const attachment = attachments.get(block.id);
      if (!attachment) {
        throw new Error(`Rich Message attachment block references unknown ID "${block.id}"`);
      }
      referencedAttachments.add(block.id);
      return renderAttachment(attachment);
    }
    case "buttonRow":
      return renderButtonRow(block);
  }
}

function countBlocks(blocks: RichMessageBlock[]): number {
  return blocks.reduce((count, block) => {
    if (block.type === "list") return count + 1 + block.items.length;
    if (block.type === "table") return count + 1 + block.rows.length;
    return count + 1;
  }, 0);
}

function blockContainsRawMediaReference(block: RichMessageBlock): boolean {
  switch (block.type) {
    case "paragraph":
      return RAW_MEDIA_REFERENCE.test(block.markdown);
    case "heading":
      return RAW_MEDIA_REFERENCE.test(block.text);
    case "quote":
      return RAW_MEDIA_REFERENCE.test(block.text) || RAW_MEDIA_REFERENCE.test(block.caption ?? "");
    case "code":
      return RAW_MEDIA_REFERENCE.test(block.code);
    case "list":
      return block.items.some((item) => RAW_MEDIA_REFERENCE.test(item.text));
    case "table":
      return (
        RAW_MEDIA_REFERENCE.test(block.caption ?? "") ||
        block.rows.some((row) => row.some((cell) => RAW_MEDIA_REFERENCE.test(cell)))
      );
    case "details":
      return RAW_MEDIA_REFERENCE.test(block.summary) || RAW_MEDIA_REFERENCE.test(block.markdown);
    case "divider":
    case "attachment":
    case "buttonRow":
      return false;
  }
}

export function compileRichMessageMarkdown(
  text: string,
  rich: RichMessageContent
): CompiledRichMessage {
  const attachments = rich.attachments ?? [];
  if (attachments.length > RICH_MESSAGE_MAX_ATTACHMENTS) {
    throw new Error(`Rich Messages support at most ${RICH_MESSAGE_MAX_ATTACHMENTS} attachments`);
  }

  const attachmentMap = new Map<string, RichMessageMediaUpload>();
  for (const attachment of attachments) {
    if (!RICH_MEDIA_ID.test(attachment.id)) {
      throw new Error(`Invalid Rich Message attachment ID "${attachment.id}"`);
    }
    if (attachmentMap.has(attachment.id)) {
      throw new Error(`Rich Message attachment ID "${attachment.id}" is duplicated`);
    }
    attachmentMap.set(attachment.id, attachment);
  }

  const blocks = rich.blocks ?? [];
  const buttonRows = rich.buttonRows ?? [];
  if (RAW_MEDIA_REFERENCE.test(text) || blocks.some(blockContainsRawMediaReference)) {
    throw new Error(
      "Define Rich Message attachments and attachment blocks instead of tg:// media references"
    );
  }
  if (blocks.length > 0 && (text.trim() || buttonRows.length > 0)) {
    throw new Error("Rich Message blocks cannot be combined with top-level text or buttonRows");
  }
  const totalBlocks =
    blocks.length > 0
      ? countBlocks(blocks)
      : (text.trim() ? 1 : 0) + attachments.length + buttonRows.length;
  if (totalBlocks > RICH_MESSAGE_MAX_BLOCKS) {
    throw new Error(`Rich Messages support at most ${RICH_MESSAGE_MAX_BLOCKS} blocks`);
  }

  const referencedAttachments = new Set<string>();
  let parts: string[];
  if (blocks.length > 0) {
    parts = blocks.map((block) => renderBlock(block, attachmentMap, referencedAttachments));
  } else {
    parts = [
      text,
      ...attachments.map((attachment) => {
        referencedAttachments.add(attachment.id);
        return renderAttachment(attachment);
      }),
      ...buttonRows.map(renderButtonRow),
    ];
  }

  for (const attachment of attachments) {
    if (!referencedAttachments.has(attachment.id)) {
      throw new Error(`Rich Message attachment "${attachment.id}" is not referenced by a block`);
    }
  }

  const markdown = parts
    .filter((part) => part.trim())
    .join("\n\n")
    .trim();
  if (!markdown) throw new Error("Rich Message content cannot be empty");
  if (Buffer.byteLength(markdown, "utf8") > RICH_MESSAGE_MAX_BYTES) {
    throw new Error(`Rich Message content exceeds ${RICH_MESSAGE_MAX_BYTES} UTF-8 bytes`);
  }

  return {
    markdown,
    attachments,
    rtl: rich.rtl,
    disableAutoLinks: rich.disableAutoLinks,
  };
}
