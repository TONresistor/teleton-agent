/**
 * Telegram message formatting utilities
 * Converts standard Markdown to Telegram-compatible HTML
 */

/**
 * Escape HTML special characters to prevent injection
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sanitize URL to prevent javascript:/data:/vbscript:/file: injection
 */
function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return "#";
  return url;
}

/**
 * Convert standard Markdown to Telegram HTML format
 *
 * Supports:
 * - **bold** or __bold__ → <b>bold</b>
 * - *italic* or _italic_ → <i>italic</i>
 * - ~~strikethrough~~ → <s>strikethrough</s>
 * - `inline code` → <code>inline code</code>
 * - ```code block``` → <pre>code block</pre>
 * - [text](url) → <a href="url">text</a>
 * - ||spoiler|| → <tg-spoiler>spoiler</tg-spoiler>
 * - > blockquote → <blockquote>blockquote</blockquote>
 * - Lists (3+ consecutive "- " lines) → <blockquote>list</blockquote>
 * - 15+ lines → <blockquote expandable>
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  let html = markdown;

  // First, protect code blocks, inline code, and blockquotes from other transformations
  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  const blockquotes: string[] = [];

  // Extract code blocks (```...```)
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    // Escape HTML inside code blocks
    const escapedCode = escapeHtml(code.trim());
    if (lang) {
      codeBlocks.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
    } else {
      codeBlocks.push(`<pre>${escapedCode}</pre>`);
    }
    return `\x00CODEBLOCK${index}\x00`;
  });

  // Extract inline code (`...`)
  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINECODE${index}\x00`;
  });

  // Auto-wrap dash lists (3+ consecutive lines starting with "- ")
  // 3-14 lines: <blockquote>, 15+ lines: <blockquote expandable>
  const listPattern = /^(- .+(?:\n- .+){2,})/gm;
  html = html.replace(listPattern, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    // Escape HTML in list content before applying inline formatting
    const content = escapeHtml(match)
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/__([^_]+)__/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>")
      .replace(/(?<!_)_([^_]+)_(?!_)/g, "<i>$1</i>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  // Extract manual blockquotes (consecutive lines starting with >)
  // 3-14 lines: <blockquote>, 15+ lines: <blockquote expandable>
  html = html.replace(/^(>.*(?:\n>.*)*)/gm, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    // Remove > prefix from each line and escape HTML
    let content = escapeHtml(
      match
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
    );

    // Apply inline formatting to blockquote content
    content = content
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/__([^_]+)__/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>")
      .replace(/(?<!_)_([^_]+)_(?!_)/g, "<i>$1</i>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  // Escape HTML in remaining text (placeholders are safe - they don't contain &, <, >)
  html = escapeHtml(html);

  // Spoilers: ||text|| → <tg-spoiler>text</tg-spoiler>
  html = html.replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

  // Bold: **text** or __text__ → <b>text</b>
  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/__([^_]+)__/g, "<b>$1</b>");

  // Strikethrough: ~~text~~ → <s>text</s>
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  // Italic: *text* or _text_ → <i>text</i>
  // Be careful not to match already converted bold markers
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<i>$1</i>");
  html = html.replace(/(?<!_)_([^_]+)_(?!_)/g, "<i>$1</i>");

  // Links: [text](url) → <a href="url">text</a>
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
  );

  // Restore blockquotes
  blockquotes.forEach((quote, index) => {
    html = html.replace(`\x00BLOCKQUOTE${index}\x00`, quote);
  });

  // Restore code blocks
  codeBlocks.forEach((block, index) => {
    html = html.replace(`\x00CODEBLOCK${index}\x00`, block);
  });

  // Restore inline codes
  inlineCodes.forEach((code, index) => {
    html = html.replace(`\x00INLINECODE${index}\x00`, code);
  });

  return html;
}
