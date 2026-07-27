import type { RegisteredTool, ToolNamespaceMetadata } from "./types.js";

export const MAX_TOOLS_PER_NAMESPACE = 10;
const MAX_PROMPT_NAMESPACE_CARDS = 24;
const MAX_PROMPT_CATALOG_CHARS = 4096;
const MAX_NAMESPACE_DESCRIPTION_CHARS = 180;

export interface ToolNamespaceCatalogEntry extends ToolNamespaceMetadata {
  toolNames: string[];
  /** Richer private search text. Never rendered directly into the model prompt. */
  searchText: string;
}

export interface NamespaceSearchResult extends ToolNamespaceCatalogEntry {
  score: number;
  vectorScore?: number;
  keywordScore?: number;
}

interface NamespaceRule extends ToolNamespaceMetadata {
  matches: (toolName: string) => boolean;
}

const TELEGRAM_SCHEDULE_RE = /scheduled|schedule_message|create_scheduled_task/;
const TELEGRAM_CHANNEL_RE = /channel|join_channel|leave_channel|invite_to_channel/;
const TELEGRAM_GIFT_MANAGE_RE =
  /buy_resale_gift|set_gift_status|set_collectible_price|send_gift_offer|resolve_gift_offer|my_gifts|user_gifts/;

/**
 * Reviewed built-in taxonomy. Rules are ordered from most specific to broadest.
 * Descriptions explain capabilities rather than implementation details because they
 * are the model's first-stage routing surface.
 */
const BUILTIN_NAMESPACE_RULES: NamespaceRule[] = [
  {
    name: "system.discovery",
    description: "Discover and load additional tools for the current task.",
    matches: (name) => name === "tool_search",
  },
  {
    name: "telegram.scheduling",
    description: "Create, inspect, send, or delete scheduled Telegram messages and tasks.",
    matches: (name) => name.startsWith("telegram_") && TELEGRAM_SCHEDULE_RE.test(name),
  },
  {
    name: "telegram.channels",
    description: "Create, join, leave, inspect, configure, and invite users to Telegram channels.",
    matches: (name) => name.startsWith("telegram_") && TELEGRAM_CHANNEL_RE.test(name),
  },
  {
    name: "telegram.gifts.manage",
    description: "Manage owned Telegram gifts, resale purchases, prices, status, and gift offers.",
    matches: (name) => name.startsWith("telegram_") && TELEGRAM_GIFT_MANAGE_RE.test(name),
  },
  {
    name: "telegram.gifts.market",
    description: "Inspect Telegram gift catalogs, resale listings, collectibles, and valuations.",
    matches: (name) =>
      name.startsWith("telegram_") && (name.includes("gift") || name.includes("collectible")),
  },
  {
    name: "telegram.messaging",
    description:
      "Send, quote, edit, delete, forward, pin, and inspect Telegram messages and replies.",
    matches: (name) =>
      name === "bot_inline_send" ||
      name === "telegram_send_buttons" ||
      /telegram_(send_message|quote_reply|get_replies|edit_message|delete_message|forward_message|pin_message|unpin_message)/.test(
        name
      ),
  },
  {
    name: "telegram.chats",
    description:
      "Search and read Telegram dialogs, account messages, public posts, histories, and chat information.",
    matches: (name) =>
      /telegram_(get_dialogs|get_history|get_chat_info|mark_as_read|search_messages|search_global|search_posts)/.test(
        name
      ),
  },
  {
    name: "telegram.groups",
    description:
      "Create and administer Telegram groups, participants, moderation, and chat photos.",
    matches: (name) =>
      /telegram_(get_me|get_participants|kick_user|ban_user|unban_user|create_group|set_chat_photo)/.test(
        name
      ),
  },
  {
    name: "telegram.media",
    description:
      "Send, download, transcribe, or analyze Telegram photos, voice, GIFs, and stickers.",
    matches: (name) =>
      /telegram_(send_photo|send_voice|send_sticker|send_gif|download_media|transcribe_audio)/.test(
        name
      ) || name === "vision_analyze",
  },
  {
    name: "telegram.interactive",
    description:
      "Create Telegram polls, quizzes, keyboards, reactions, dice, and interactive buttons.",
    matches: (name) =>
      /telegram_(create_poll|create_quiz|reply_keyboard|react|send_dice)/.test(name),
  },
  {
    name: "telegram.stickers",
    description: "Search and manage Telegram stickers, sticker sets, and GIF discovery.",
    matches: (name) =>
      /telegram_(search_stickers|search_gifs|get_my_stickers|add_sticker_set)/.test(name),
  },
  {
    name: "telegram.contacts",
    description:
      "Inspect Telegram users, usernames, common chats, blocked users, and blocking controls.",
    matches: (name) =>
      /telegram_(block_user|get_blocked|get_common_chats|get_user_info|check_username)/.test(name),
  },
  {
    name: "telegram.folders",
    description: "Inspect and manage Telegram chat folders.",
    matches: (name) => /telegram_(get_folders|create_folder|add_chat_to_folder)/.test(name),
  },
  {
    name: "telegram.profile",
    description: "Update the Telegram profile, bio, username, and personal channel.",
    matches: (name) =>
      /telegram_(update_profile|set_bio|set_username|set_personal_channel)/.test(name),
  },
  {
    name: "telegram.stars",
    description: "Inspect Telegram Stars balances and transaction history.",
    matches: (name) => name.startsWith("telegram_get_stars_"),
  },
  {
    name: "telegram.stories",
    description: "Publish Telegram stories.",
    matches: (name) => name === "telegram_send_story",
  },
  {
    name: "telegram.memory",
    description: "Read, search, and update agent memory and prior session history.",
    matches: (name) => /^(memory_read|memory_search|memory_write|session_search)$/.test(name),
  },
  {
    name: "ton.jettons",
    description:
      "Inspect and transfer TON jettons, balances, metadata, prices, holders, and history.",
    matches: (name) => name.startsWith("jetton_"),
  },
  {
    name: "ton.market",
    description: "Inspect TON prices and charts, compare DEX quotes, and list wallet NFTs.",
    matches: (name) => /^(ton_price|ton_chart|dex_quote|nft_list)$/.test(name),
  },
  {
    name: "ton.wallet",
    description: "Inspect the TON wallet, balances and transactions, or send TON.",
    matches: (name) => name.startsWith("ton_") && name !== "ton_proxy_status",
  },
  {
    name: "ton.dns",
    description:
      "Resolve and manage TON DNS names, auctions, bids, wallet links, and site records.",
    matches: (name) => name.startsWith("dns_"),
  },
  {
    name: "ton.stonfi",
    description: "Search STON.fi assets and pools, inspect trends and quotes, or execute swaps.",
    matches: (name) => name.startsWith("stonfi_"),
  },
  {
    name: "ton.dedust",
    description: "Inspect DeDust pools, tokens, prices and quotes, or execute swaps.",
    matches: (name) => name.startsWith("dedust_"),
  },
  {
    name: "ton.infrastructure",
    description: "Inspect and manage local TON infrastructure services.",
    matches: (name) => name === "ton_proxy_status",
  },
  {
    name: "workspace",
    description: "Inspect, read, create, rename, and delete files inside the agent workspace.",
    matches: (name) => name.startsWith("workspace_"),
  },
  {
    name: "exec",
    description:
      "Run shell commands, install packages, inspect execution status, and manage services.",
    matches: (name) => name.startsWith("exec_"),
  },
  {
    name: "web",
    description: "Search the public web and fetch page content.",
    matches: (name) => name.startsWith("web_"),
  },
  {
    name: "journal",
    description: "Create, inspect, and update the agent trading and activity journal.",
    matches: (name) => name.startsWith("journal_"),
  },
];

function cleanNamespacePart(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
  return cleaned || "tools";
}

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveToolNamespace(
  toolName: string,
  moduleName: string,
  _toolDescription: string
): ToolNamespaceMetadata {
  const builtin = BUILTIN_NAMESPACE_RULES.find((rule) => rule.matches(toolName));
  if (builtin) return { name: builtin.name, description: builtin.description };

  const name = cleanNamespacePart(moduleName);
  return {
    name,
    description: `${humanize(moduleName)} plugin capabilities.`,
  };
}

function subgroupKey(toolName: string, namespaceName: string): string {
  const namespaceParts = new Set(namespaceName.split(".").map(cleanNamespacePart));
  const parts = toolName.split("_").map(cleanNamespacePart).filter(Boolean);
  const candidate = parts.find((part) => !namespaceParts.has(part));
  return candidate ?? "general";
}

function namespaceSearchText(
  namespace: ToolNamespaceMetadata,
  tools: Array<Pick<RegisteredTool, "tool">>
): string {
  return [
    namespace.name,
    namespace.description,
    ...tools.flatMap(({ tool }) => [tool.name, tool.description]),
  ].join(" ");
}

function toCatalogEntry(
  namespace: ToolNamespaceMetadata,
  tools: Array<Pick<RegisteredTool, "tool">>
): ToolNamespaceCatalogEntry {
  const sorted = [...tools].sort((a, b) => a.tool.name.localeCompare(b.tool.name));
  return {
    ...namespace,
    toolNames: sorted.map(({ tool }) => tool.name),
    searchText: namespaceSearchText(namespace, sorted),
  };
}

function chunkNamespace(
  namespace: ToolNamespaceMetadata,
  tools: Array<Pick<RegisteredTool, "tool">>
): ToolNamespaceCatalogEntry[] {
  if (tools.length <= MAX_TOOLS_PER_NAMESPACE) return [toCatalogEntry(namespace, tools)];

  const bySubgroup = new Map<string, Array<Pick<RegisteredTool, "tool">>>();
  for (const tool of tools) {
    const key = subgroupKey(tool.tool.name, namespace.name);
    const group = bySubgroup.get(key) ?? [];
    group.push(tool);
    bySubgroup.set(key, group);
  }

  // A common prefix did not create useful subgroups. Deterministically chunk it.
  if (bySubgroup.size === 1) {
    const sorted = [...tools].sort((a, b) => a.tool.name.localeCompare(b.tool.name));
    const chunks: ToolNamespaceCatalogEntry[] = [];
    for (let index = 0; index < sorted.length; index += MAX_TOOLS_PER_NAMESPACE) {
      const part = index / MAX_TOOLS_PER_NAMESPACE + 1;
      chunks.push(
        toCatalogEntry(
          {
            name: `${namespace.name}.part${part}`,
            description: `${namespace.description} Part ${part}.`,
          },
          sorted.slice(index, index + MAX_TOOLS_PER_NAMESPACE)
        )
      );
    }
    return chunks;
  }

  const result: ToolNamespaceCatalogEntry[] = [];
  for (const [key, subgroupTools] of [...bySubgroup.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const subgroup: ToolNamespaceMetadata = {
      name: `${namespace.name}.${key}`,
      description: `${namespace.description} Focus: ${humanize(key)}.`,
    };
    result.push(...chunkNamespace(subgroup, subgroupTools));
  }
  return result;
}

export function buildToolNamespaceCatalog(
  tools: Array<Pick<RegisteredTool, "tool" | "namespace">>
): ToolNamespaceCatalogEntry[] {
  const grouped = new Map<
    string,
    { namespace: ToolNamespaceMetadata; tools: Array<Pick<RegisteredTool, "tool">> }
  >();

  for (const registered of tools) {
    if (registered.tool.name === "tool_search" || registered.tool.name === "tool_result_read") {
      continue;
    }
    const current = grouped.get(registered.namespace.name) ?? {
      namespace: registered.namespace,
      tools: [],
    };
    current.tools.push({ tool: registered.tool });
    grouped.set(registered.namespace.name, current);
  }

  return [...grouped.values()]
    .flatMap(({ namespace, tools: namespaceTools }) => chunkNamespace(namespace, namespaceTools))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function compactDescription(description: string): string {
  const normalized = description.replace(/\s+/g, " ").trim();
  return normalized.length <= MAX_NAMESPACE_DESCRIPTION_CHARS
    ? normalized
    : `${normalized.slice(0, MAX_NAMESPACE_DESCRIPTION_CHARS - 1)}…`;
}

/** Render a bounded, permission-filtered routing surface into the core tool description. */
export function formatNamespaceCatalogForPrompt(catalog: ToolNamespaceCatalogEntry[]): string {
  if (catalog.length === 0) return "";

  if (catalog.length <= MAX_PROMPT_NAMESPACE_CARDS) {
    return renderBoundedPromptLines(
      catalog.map(
        (entry) =>
          `- ${entry.name} (${entry.toolNames.length}): ${compactDescription(entry.description)}`
      )
    );
  }

  const roots = new Map<string, { namespaces: number; tools: number; samples: string[] }>();
  for (const entry of catalog) {
    const root = entry.name.split(".")[0];
    const current = roots.get(root) ?? { namespaces: 0, tools: 0, samples: [] };
    current.namespaces++;
    current.tools += entry.toolNames.length;
    if (current.samples.length < 4) current.samples.push(entry.name);
    roots.set(root, current);
  }

  return renderBoundedPromptLines(
    [...roots.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([root, value]) =>
          `- ${root} (${value.namespaces} namespaces, ${value.tools} tools): ${value.samples.join(", ")}`
      )
  );
}

function renderBoundedPromptLines(lines: string[]): string {
  const maxVisible =
    lines.length > MAX_PROMPT_NAMESPACE_CARDS
      ? MAX_PROMPT_NAMESPACE_CARDS - 1
      : MAX_PROMPT_NAMESPACE_CARDS;
  const visible = lines.slice(0, maxVisible);
  let omitted = lines.length - visible.length;

  const render = (): string => {
    const output = [...visible];
    if (omitted > 0) output.push(`- … ${omitted} additional namespace entries omitted`);
    return output.join("\n");
  };

  while (render().length > MAX_PROMPT_CATALOG_CHARS && visible.length > 0) {
    visible.pop();
    omitted++;
  }
  return render();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

/** Deterministic fallback when embeddings or the persistent tool index are unavailable. */
export function rankNamespacesLexically(
  query: string,
  catalog: ToolNamespaceCatalogEntry[],
  limit: number
): NamespaceSearchResult[] {
  const queryTokens = new Set(tokenize(query));
  const normalizedQuery = cleanNamespacePart(query);
  return catalog
    .map((entry) => {
      const candidateTokens = new Set(tokenize(entry.searchText));
      let overlap = 0;
      for (const token of queryTokens) if (candidateTokens.has(token)) overlap++;
      const keywordScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
      const exactBoost =
        entry.name === normalizedQuery || normalizedQuery.startsWith(`${entry.name}.`) ? 1 : 0;
      return { ...entry, score: Math.min(1, keywordScore + exactBoost), keywordScore };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function rankToolsLexically<T extends { name: string; description?: string }>(
  query: string,
  tools: T[],
  limit: number
): T[] {
  const queryTokens = new Set(tokenize(query));
  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return tools
    .map((tool) => {
      const candidateTokens = new Set(tokenize(`${tool.name} ${tool.description ?? ""}`));
      let overlap = 0;
      for (const token of queryTokens) if (candidateTokens.has(token)) overlap++;
      const overlapScore = queryTokens.size > 0 ? overlap / queryTokens.size : 0;
      const exactBoost =
        tool.name === normalizedQuery || normalizedQuery.includes(tool.name) ? 1 : 0;
      return { tool, score: overlapScore + exactBoost };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map(({ tool }) => tool);
}
