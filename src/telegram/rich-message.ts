import { Api } from "telegram";
import type { TelegramClient } from "telegram";

type MessageWithRichContent = Api.Message & {
  richMessage?: Api.TypeRichMessage;
};

type RichMessageClient = Pick<TelegramClient, "invoke">;
type RichMessageMediaType = "photo" | "document" | "video" | "audio";

export interface ResolvedTelegramMessageContent {
  text: string;
  richMessage?: Api.TypeRichMessage;
}

const MAX_CONCURRENT_RICH_MESSAGE_HYDRATIONS = 4;
let activeRichMessageHydrations = 0;
const richMessageHydrationWaiters: Array<() => void> = [];

async function acquireRichMessageHydrationSlot(): Promise<void> {
  if (activeRichMessageHydrations < MAX_CONCURRENT_RICH_MESSAGE_HYDRATIONS) {
    activeRichMessageHydrations += 1;
    return;
  }
  await new Promise<void>((resolve) => richMessageHydrationWaiters.push(resolve));
}

function releaseRichMessageHydrationSlot(): void {
  const next = richMessageHydrationWaiters.shift();
  if (next) {
    next();
    return;
  }
  activeRichMessageHydrations -= 1;
}

async function withRichMessageHydrationSlot<T>(operation: () => Promise<T>): Promise<T> {
  await acquireRichMessageHydrationSlot();
  try {
    return await operation();
  } finally {
    releaseRichMessageHydrationSlot();
  }
}

function renderRichText(text: Api.TypeRichText): string {
  if (text instanceof Api.TextEmpty) return "";
  if (text instanceof Api.TextPlain) return text.text;
  if (text instanceof Api.TextConcat) return text.texts.map(renderRichText).join("");
  if (text instanceof Api.TextBold) return `**${renderRichText(text.text)}**`;
  if (text instanceof Api.TextItalic) return `*${renderRichText(text.text)}*`;
  if (text instanceof Api.TextUnderline) return `<u>${renderRichText(text.text)}</u>`;
  if (text instanceof Api.TextStrike) return `~~${renderRichText(text.text)}~~`;
  if (text instanceof Api.TextFixed) {
    return `\`${renderRichText(text.text).replaceAll("`", "\\`")}\``;
  }
  if (text instanceof Api.TextUrl) return `[${renderRichText(text.text)}](${text.url})`;
  if (text instanceof Api.TextEmail) {
    return `[${renderRichText(text.text)}](mailto:${text.email})`;
  }
  if (text instanceof Api.TextSubscript) return `<sub>${renderRichText(text.text)}</sub>`;
  if (text instanceof Api.TextSuperscript) return `<sup>${renderRichText(text.text)}</sup>`;
  if (text instanceof Api.TextMarked) return `==${renderRichText(text.text)}==`;
  if (text instanceof Api.TextPhone) {
    return `[${renderRichText(text.text)}](tel:${text.phone})`;
  }
  if (text instanceof Api.TextImage) return "[image]";
  if (text instanceof Api.TextAnchor) return renderRichText(text.text);
  if (text instanceof Api.TextMath) return `$${text.source}$`;
  if (text instanceof Api.TextCustomEmoji) return text.alt;
  if (text instanceof Api.TextSpoiler) return `||${renderRichText(text.text)}||`;
  if (
    text instanceof Api.TextMention ||
    text instanceof Api.TextHashtag ||
    text instanceof Api.TextBotCommand ||
    text instanceof Api.TextCashtag ||
    text instanceof Api.TextAutoUrl ||
    text instanceof Api.TextAutoEmail ||
    text instanceof Api.TextAutoPhone ||
    text instanceof Api.TextBankCard ||
    text instanceof Api.TextMentionName ||
    text instanceof Api.TextDate
  ) {
    return renderRichText(text.text);
  }
  if (text instanceof Api.TextDiff) return renderRichText(text.text);
  return "";
}

function renderCaption(caption: Api.TypePageCaption): string {
  const text = renderRichText(caption.text);
  const credit = renderRichText(caption.credit);
  if (text && credit) return `${text}\n\n— ${credit}`;
  return text || credit;
}

function quote(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function renderListItem(item: Api.TypePageListItem): string {
  const content =
    item instanceof Api.PageListItemText
      ? renderRichText(item.text)
      : item instanceof Api.PageListItemBlocks
        ? renderBlocks(item.blocks)
        : "";
  const marker = item.checkbox ? `[${item.checked ? "x" : " "}] ` : "";
  return `${marker}${content}`.replaceAll("\n", "\n  ");
}

function renderOrderedListItem(item: Api.TypePageListOrderedItem): string {
  const content =
    item instanceof Api.PageListOrderedItemText
      ? renderRichText(item.text)
      : item instanceof Api.PageListOrderedItemBlocks
        ? renderBlocks(item.blocks)
        : "";
  const checkbox = item.checkbox ? `[${item.checked ? "x" : " "}] ` : "";
  return `${checkbox}${content}`.replaceAll("\n", "\n   ");
}

function renderTable(block: Api.PageBlockTable): string {
  const title = renderRichText(block.title);
  if (block.rows.length === 0) return title;

  const columnCount = Math.max(...block.rows.map((row) => row.cells.length));
  const rows = block.rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => {
      const cell = row.cells[index];
      return cell?.text
        ? renderRichText(cell.text).replaceAll("|", "\\|").replaceAll("\n", "<br>")
        : "";
    })
  );
  const markdownRows = [
    `| ${rows[0].join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ];
  return [title ? `**${title}**` : "", markdownRows.join("\n")].filter(Boolean).join("\n\n");
}

function renderBlock(block: Api.TypePageBlock): string {
  if (block instanceof Api.PageBlockUnsupported || block instanceof Api.PageBlockAnchor) return "";
  if (block instanceof Api.PageBlockTitle || block instanceof Api.PageBlockHeading1) {
    return `# ${renderRichText(block.text)}`;
  }
  if (
    block instanceof Api.PageBlockSubtitle ||
    block instanceof Api.PageBlockHeader ||
    block instanceof Api.PageBlockHeading2
  ) {
    return `## ${renderRichText(block.text)}`;
  }
  if (block instanceof Api.PageBlockSubheader || block instanceof Api.PageBlockHeading3) {
    return `### ${renderRichText(block.text)}`;
  }
  if (block instanceof Api.PageBlockHeading4) return `#### ${renderRichText(block.text)}`;
  if (block instanceof Api.PageBlockHeading5) return `##### ${renderRichText(block.text)}`;
  if (block instanceof Api.PageBlockHeading6) return `###### ${renderRichText(block.text)}`;
  if (block instanceof Api.PageBlockParagraph) return renderRichText(block.text);
  if (block instanceof Api.PageBlockPreformatted) {
    const source = renderRichText(block.text);
    const fence = source.includes("```") ? "````" : "```";
    return `${fence}${block.language}\n${source}\n${fence}`;
  }
  if (block instanceof Api.PageBlockFooter) return `*${renderRichText(block.text)}*`;
  if (block instanceof Api.PageBlockKicker) return `**${renderRichText(block.text)}**`;
  if (block instanceof Api.PageBlockAuthorDate) return renderRichText(block.author);
  if (block instanceof Api.PageBlockDivider) return "---";
  if (block instanceof Api.PageBlockList) {
    return block.items.map((item) => `- ${renderListItem(item)}`).join("\n");
  }
  if (block instanceof Api.PageBlockOrderedList) {
    const start = block.start ?? 1;
    return block.items
      .map((item, index) => {
        const number = item.num ?? item.value ?? start + index;
        return `${number}. ${renderOrderedListItem(item)}`;
      })
      .join("\n");
  }
  if (block instanceof Api.PageBlockBlockquote || block instanceof Api.PageBlockPullquote) {
    const text = renderRichText(block.text);
    const caption = renderRichText(block.caption);
    return quote([text, caption ? `— ${caption}` : ""].filter(Boolean).join("\n\n"));
  }
  if (block instanceof Api.PageBlockBlockquoteBlocks) {
    const content = renderBlocks(block.blocks);
    const caption = renderRichText(block.caption);
    return quote([content, caption ? `— ${caption}` : ""].filter(Boolean).join("\n\n"));
  }
  if (block instanceof Api.PageBlockCover) return renderBlock(block.cover);
  if (block instanceof Api.PageBlockCollage || block instanceof Api.PageBlockSlideshow) {
    return [renderBlocks(block.items), renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockEmbedPost) {
    const author = block.author ? `**${block.author}**` : "";
    const link = block.url ? `[Open post](${block.url})` : "";
    return [author, link, renderBlocks(block.blocks), renderCaption(block.caption)]
      .filter(Boolean)
      .join("\n\n");
  }
  if (block instanceof Api.PageBlockEmbed) {
    const embed = block.url ? `[Embed](${block.url})` : "[Embed]";
    return [embed, renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockPhoto) {
    return ["[Photo]", renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockVideo) {
    return ["[Video]", renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockAudio) {
    return ["[Audio]", renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockMap) {
    return ["[Map]", renderCaption(block.caption)].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockChannel) {
    return "title" in block.channel ? block.channel.title : "";
  }
  if (block instanceof Api.PageBlockTable) return renderTable(block);
  if (block instanceof Api.PageBlockDetails) {
    const open = block.open ? " open" : "";
    return `<details${open}>
<summary>${renderRichText(block.title)}</summary>

${renderBlocks(block.blocks)}

</details>`;
  }
  if (block instanceof Api.PageBlockRelatedArticles) {
    const title = renderRichText(block.title);
    const articles = block.articles
      .map((article) => {
        const label = article.title || article.description || article.url;
        return `- [${label}](${article.url})`;
      })
      .join("\n");
    return [title ? `**${title}**` : "", articles].filter(Boolean).join("\n\n");
  }
  if (block instanceof Api.PageBlockMath) return `$$\n${block.source}\n$$`;
  if (block instanceof Api.PageBlockThinking) {
    return quote(`Thinking: ${renderRichText(block.text)}`);
  }
  return "";
}

function renderBlocks(blocks: Api.TypePageBlock[]): string {
  return blocks.map(renderBlock).filter(Boolean).join("\n\n").trim();
}

export function renderRichMessageToMarkdown(richMessage: Api.TypeRichMessage): string {
  const rendered = renderBlocks(richMessage.blocks);
  if (rendered) return rendered;

  return [
    ...richMessage.photos.map(() => "[Photo]"),
    ...richMessage.documents.map(() => "[Document]"),
  ].join("\n\n");
}

export function getTelegramRichMessage(message: Api.Message): Api.TypeRichMessage | undefined {
  return (message as MessageWithRichContent).richMessage;
}

function classifyRichMessageBlock(block: Api.TypePageBlock): RichMessageMediaType | undefined {
  if (block instanceof Api.PageBlockPhoto) return "photo";
  if (block instanceof Api.PageBlockVideo) return "video";
  if (block instanceof Api.PageBlockAudio) return "audio";
  if (block instanceof Api.PageBlockCover) return classifyRichMessageBlock(block.cover);
  if (block instanceof Api.PageBlockCollage || block instanceof Api.PageBlockSlideshow) {
    for (const item of block.items) {
      const mediaType = classifyRichMessageBlock(item);
      if (mediaType) return mediaType;
    }
  }
  return undefined;
}

export function classifyRichMessageMedia(
  richMessage: Api.TypeRichMessage
): RichMessageMediaType | undefined {
  for (const block of richMessage.blocks) {
    const mediaType = classifyRichMessageBlock(block);
    if (mediaType) return mediaType;
  }
  if (richMessage.photos.length > 0) return "photo";
  if (richMessage.documents.length > 0) return "document";
  return undefined;
}

export function classifyTelegramRichMessageMedia(
  message: Api.Message
): RichMessageMediaType | undefined {
  const richMessage = getTelegramRichMessage(message);
  return richMessage ? classifyRichMessageMedia(richMessage) : undefined;
}

export function renderTelegramMessageText(message: Api.Message): string {
  const richMessage = getTelegramRichMessage(message);
  if (richMessage) {
    const rendered = renderRichMessageToMarkdown(richMessage);
    if (rendered) return rendered;
  }
  return message.message ?? "";
}

export async function resolveTelegramMessageContent(
  client: RichMessageClient,
  message: Api.Message,
  peer?: Api.TypeEntityLike
): Promise<ResolvedTelegramMessageContent> {
  const richMessage = getTelegramRichMessage(message);
  const fallback = {
    text: renderTelegramMessageText(message),
    richMessage,
  };
  if (!richMessage?.part) return fallback;

  const targetPeer = peer ?? message.peerId;
  if (!targetPeer) return fallback;

  try {
    const response = await withRichMessageHydrationSlot(() =>
      client.invoke(
        new Api.messages.GetRichMessage({
          peer: targetPeer,
          id: message.id,
        })
      )
    );
    const messages = "messages" in response ? response.messages : [];
    const complete = messages.find(
      (candidate): candidate is Api.Message =>
        candidate instanceof Api.Message && candidate.id === message.id
    );
    if (complete) {
      const resolved = renderTelegramMessageText(complete);
      return {
        text: resolved || fallback.text,
        richMessage: getTelegramRichMessage(complete) ?? richMessage,
      };
    }
  } catch {
    // The embedded partial payload is still useful when hydration is unavailable.
  }

  return fallback;
}

export async function resolveTelegramMessageText(
  client: RichMessageClient,
  message: Api.Message,
  peer?: Api.TypeEntityLike
): Promise<string> {
  const content = await resolveTelegramMessageContent(client, message, peer);
  return content.text;
}
