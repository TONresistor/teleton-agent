function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  if (/^(javascript|data|vbscript|file):/i.test(trimmed)) return "#";
  return url.replace(/"/g, "&quot;");
}

export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return "";

  let html = markdown;

  const codeBlocks: string[] = [];
  const inlineCodes: string[] = [];
  const blockquotes: string[] = [];

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_match, lang, code) => {
    const index = codeBlocks.length;
    const escapedCode = escapeHtml(code.trim());
    if (lang) {
      codeBlocks.push(`<pre><code class="language-${lang}">${escapedCode}</code></pre>`);
    } else {
      codeBlocks.push(`<pre>${escapedCode}</pre>`);
    }
    return `\x00CODEBLOCK${index}\x00`;
  });

  html = html.replace(/`([^`]+)`/g, (_match, code) => {
    const index = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00INLINECODE${index}\x00`;
  });

  const listPattern = /^(- .+(?:\n- .+){2,})/gm;
  html = html.replace(listPattern, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    const content = escapeHtml(match)
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  html = html.replace(/^(>.*(?:\n>.*)*)/gm, (match) => {
    const index = blockquotes.length;
    const lineCount = match.split("\n").length;

    let content = escapeHtml(
      match
        .split("\n")
        .map((line) => line.replace(/^>\s?/, ""))
        .join("\n")
    );

    content = content
      .replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>")
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/~~([^~]+)~~/g, "<s>$1</s>")
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
      );

    const tag = lineCount >= 15 ? "<blockquote expandable>" : "<blockquote>";
    blockquotes.push(`${tag}${content}</blockquote>`);
    return `\x00BLOCKQUOTE${index}\x00`;
  });

  html = escapeHtml(html);

  html = html.replace(/\|\|([^|]+)\|\|/g, "<tg-spoiler>$1</tg-spoiler>");

  html = html.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  html = html.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, text, url) => `<a href="${sanitizeUrl(url)}">${text}</a>`
  );

  blockquotes.forEach((quote, index) => {
    html = html.replace(`\x00BLOCKQUOTE${index}\x00`, quote);
  });

  codeBlocks.forEach((block, index) => {
    html = html.replace(`\x00CODEBLOCK${index}\x00`, block);
  });

  inlineCodes.forEach((code, index) => {
    html = html.replace(`\x00INLINECODE${index}\x00`, code);
  });

  return html;
}
