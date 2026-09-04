function trimExtraWhitespace(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function humanizeText(text, config = {}) {
  let out = trimExtraWhitespace(text);

  out = out
    .replace(/\b([A-Za-z]+) — ([A-Za-z]+)\b/g, "$1, $2")
    .replace(/\bAdditionally,\s+/g, "")
    .replace(/\bMoreover,\s+/g, "")
    .replace(/\bFurthermore,\s+/g, "")
    .replace(/\bIn conclusion,\s+/g, "")
    .replace(/\bIt is important to note that\s+/gi, "")
    .replace(/\bThis underscores(?: the)? importance of\s+/gi, "")
    .replace(/\bserves as\b/gi, "is")
    .replace(/\bstands as\b/gi, "is")
    .replace(/\bboasts\b/gi, "has")
    .replace(/\benhances?\b/gi, "improves")
    .replace(/\bshowcasing\b/gi, "showing")
    .replace(/\bhighlighting\b/gi, "showing")
    .replace(/\bunderscoring\b/gi, "showing")
    .replace(/\bthere is\b/gi, "there's");

  if (config.avoid_em_dash !== false) {
    out = out.replace(/—/g, ",");
  }

  if (config.prefer_short !== false) {
    out = out
      .split(/\n+/)
      .map((line) => line.replace(/\s{2,}/g, " "))
      .join("\n");
  }

  if (config.max_length && out.length > config.max_length) {
    out = out.slice(0, Math.max(0, config.max_length - 1)).trimEnd() + "…";
  }

  return out;
}

function appendLearning(sdk, kind, text) {
  const line = `[${new Date().toISOString()}] ${kind}: ${trimExtraWhitespace(text).slice(0, 400)}`;
  try {
    if (sdk?.db) {
      const table = kind === "error" ? "errors" : kind === "feature" ? "feature_requests" : "learnings";
      sdk.db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL)`);
      sdk.db.prepare(`INSERT INTO ${table} (line) VALUES (?)`).run(line);
      return { success: true, data: line };
    }
  } catch (error) {
    return { success: false, error: String(error) };
  }
  return { success: true, data: line };
}

export const manifest = {
  name: "teleton-humanizer",
  version: "1.0.0",
  sdkVersion: "^2.0.0",
  description: "Humanize responses and record learnings",
};

export const tools = (sdk) => [
  {
    name: "humanize_text",
    description: "Rewrite text to sound more natural and concise",
    scope: "open",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to humanize" },
      },
      required: ["text"],
    },
    async execute(params) {
      const config = sdk?.pluginConfig?.humanizer || {};
      return { success: true, data: humanizeText(params.text, config) };
    },
  },
  {
    name: "record_learning",
    description: "Record a learning, error, or feature request",
    scope: "admin-only",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["learning", "error", "feature"] },
        text: { type: "string" },
      },
      required: ["kind", "text"],
    },
    async execute(params) {
      return appendLearning(sdk, params.kind, params.text);
    },
  },
];
