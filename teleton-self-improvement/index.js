function now() {
  return new Date().toISOString();
}

function normalize(text) {
  return String(text || "").replace(/\r\n/g, "\n").trim();
}

function initStorage(sdk) {
  const store = sdk.storage;
  if (!store.has("learnings")) store.set("learnings", []);
  if (!store.has("errors")) store.set("errors", []);
  if (!store.has("feature_requests")) store.set("feature_requests", []);
  if (!store.has("open_loops")) store.set("open_loops", []);
}

function pushEntry(sdk, bucket, entry) {
  initStorage(sdk);
  const current = sdk.storage.get(bucket) || [];
  const next = [...current, entry].slice(-((sdk.pluginConfig?.max_entries) || 200));
  sdk.storage.set(bucket, next);
  return entry;
}

function entry(type, text, meta = {}) {
  return {
    id: `${type.toUpperCase()}-${Date.now()}`,
    loggedAt: now(),
    type,
    text: normalize(text).slice(0, 2000),
    meta,
  };
}

export const manifest = {
  name: "teleton-self-improvement",
  version: "1.0.0",
  sdkVersion: "^2.0.0",
  description: "Capture learnings, errors, and feature requests",
};

export const migrate = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS self_improvement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
};

export const tools = (sdk) => [
  {
    name: "log_learning",
    description: "Record a learning, correction, or best practice",
    scope: "admin-only",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["text"],
    },
    async execute(params) {
      const item = entry("learning", params.text, { tags: params.tags || [] });
      pushEntry(sdk, "learnings", item);
      sdk.db?.prepare(
        "INSERT INTO self_improvement_log (kind, payload, created_at) VALUES (?, ?, ?)"
      ).run("learning", JSON.stringify(item), item.loggedAt);
      return { success: true, data: item };
    },
  },
  {
    name: "log_error",
    description: "Record a command, integration, or runtime error",
    scope: "admin-only",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        source: { type: "string" },
      },
      required: ["text"],
    },
    async execute(params) {
      const item = entry("error", params.text, { source: params.source || "unknown" });
      pushEntry(sdk, "errors", item);
      sdk.db?.prepare(
        "INSERT INTO self_improvement_log (kind, payload, created_at) VALUES (?, ?, ?)"
      ).run("error", JSON.stringify(item), item.loggedAt);
      return { success: true, data: item };
    },
  },
  {
    name: "log_feature_request",
    description: "Record a missing capability requested by the user",
    scope: "admin-only",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
      },
      required: ["text"],
    },
    async execute(params) {
      const item = entry("feature", params.text, { priority: params.priority || "medium" });
      pushEntry(sdk, "feature_requests", item);
      sdk.db?.prepare(
        "INSERT INTO self_improvement_log (kind, payload, created_at) VALUES (?, ?, ?)"
      ).run("feature", JSON.stringify(item), item.loggedAt);
      return { success: true, data: item };
    },
  },
  {
    name: "list_learnings",
    description: "List recent learnings and errors",
    scope: "open",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
    async execute(params) {
      initStorage(sdk);
      const limit = Math.max(1, Math.min(Number(params.limit || 10), 50));
      return {
        success: true,
        data: {
          learnings: (sdk.storage.get("learnings") || []).slice(-limit),
          errors: (sdk.storage.get("errors") || []).slice(-limit),
          feature_requests: (sdk.storage.get("feature_requests") || []).slice(-limit),
        },
      };
    },
  },
  {
    name: "open_loop",
    description: "Track an unresolved question, promise, or follow-up",
    scope: "open",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        chat_id: { type: "string" },
        due_hint: { type: "string" },
      },
      required: ["text"],
    },
    async execute(params, context) {
      initStorage(sdk);
      const item = entry("open_loop", params.text, {
        chat_id: params.chat_id || context?.chatId,
        due_hint: params.due_hint || null,
        status: "open",
      });
      const loops = sdk.storage.get("open_loops") || [];
      sdk.storage.set("open_loops", [...loops, item].slice(-200));
      return { success: true, data: item };
    },
  },
  {
    name: "close_loop",
    description: "Mark an unresolved follow-up as completed",
    scope: "open",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: { id: { type: "string" }, text: { type: "string" } },
    },
    async execute(params) {
      initStorage(sdk);
      const loops = sdk.storage.get("open_loops") || [];
      const needle = normalize(params.id || params.text).toLowerCase();
      let closed = 0;
      const next = loops.map((item) => {
        if (item.status === "open" && (item.id === params.id || item.text.toLowerCase().includes(needle))) {
          closed += 1;
          return { ...item, status: "closed", closedAt: now() };
        }
        return item;
      });
      sdk.storage.set("open_loops", next);
      return { success: true, data: { closed } };
    },
  },
  {
    name: "list_open_loops",
    description: "List unresolved follow-ups for proactive checks",
    scope: "open",
    category: "data-bearing",
    parameters: {
      type: "object",
      properties: { chat_id: { type: "string" }, limit: { type: "number" } },
    },
    async execute(params, context) {
      initStorage(sdk);
      const chatId = params.chat_id || context?.chatId;
      const limit = Math.max(1, Math.min(Number(params.limit || 10), 50));
      const loops = (sdk.storage.get("open_loops") || []).filter(
        (item) => item.status === "open" && (!chatId || !item.meta?.chat_id || item.meta.chat_id === chatId)
      );
      return { success: true, data: loops.slice(-limit) };
    },
  },
];
