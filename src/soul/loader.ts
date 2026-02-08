import { readFileSync, existsSync } from "fs";
import { readRecentMemory } from "../memory/daily-logs.js";
import { WORKSPACE_PATHS } from "../workspace/index.js";

const SOUL_PATHS = [WORKSPACE_PATHS.SOUL];

const STRATEGY_PATHS = [WORKSPACE_PATHS.STRATEGY];

const SECURITY_PATHS = [WORKSPACE_PATHS.SECURITY];

const MEMORY_PATH = WORKSPACE_PATHS.MEMORY;

const DEFAULT_SOUL = `# Tonnet AI

You are Tonnet, a personal AI assistant that operates through Telegram.

## Personality
- Helpful and concise
- Direct and honest
- Friendly but professional

## Guidelines
- Keep responses short and actionable
- Use markdown when appropriate
- Respect user privacy
- Be transparent about capabilities and limitations
`;

/**
 * Load the soul/personality from SOUL.md
 */
export function loadSoul(): string {
  for (const path of SOUL_PATHS) {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  }
  return DEFAULT_SOUL;
}

/**
 * Load business strategy from STRATEGY.md
 * Contains trading rules, service pricing, decision frameworks
 */
export function loadStrategy(): string | null {
  for (const path of STRATEGY_PATHS) {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  }
  return null;
}

/**
 * Load security rules from SECURITY.md
 * Always included in system prompt (even in groups)
 */
export function loadSecurity(): string | null {
  for (const path of SECURITY_PATHS) {
    if (existsSync(path)) {
      return readFileSync(path, "utf-8");
    }
  }
  return null;
}

/**
 * Load long-term memory from MEMORY.md (OpenClaw-style)
 * Contains curated facts, preferences, and durable information
 */
export function loadPersistentMemory(): string | null {
  if (existsSync(MEMORY_PATH)) {
    return readFileSync(MEMORY_PATH, "utf-8");
  }
  return null;
}

/**
 * Load all memory context (persistent + recent daily logs)
 * This is injected into the system prompt for continuity across restarts
 */
export function loadMemoryContext(): string | null {
  const parts: string[] = [];

  // Load persistent memory (MEMORY.md)
  const persistentMemory = loadPersistentMemory();
  if (persistentMemory) {
    parts.push(`## Persistent Memory\n\n${persistentMemory}`);
  }

  // Load recent daily logs (today + yesterday)
  const recentMemory = readRecentMemory();
  if (recentMemory) {
    parts.push(recentMemory);
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join("\n\n---\n\n");
}

/**
 * Build the complete system prompt combining soul, strategy, memory, and context
 */
export function buildSystemPrompt(options: {
  soul?: string;
  strategy?: string;
  userName?: string;
  senderUsername?: string;
  ownerName?: string;
  ownerUsername?: string;
  context?: string;
  includeMemory?: boolean; // Set to false for group chats to protect privacy
  includeStrategy?: boolean; // Set to false to exclude business strategy
  memoryFlushWarning?: boolean; // Show warning when context is near threshold
}): string {
  const soul = options.soul ?? loadSoul();
  const parts = [soul];

  // Load security rules (SECURITY.md) - ALWAYS included, even in groups
  const security = loadSecurity();
  if (security) {
    parts.push(`\n${security}`);
  }

  // Load business strategy (STRATEGY.md)
  // Include by default - agent needs to know how to operate
  const includeStrategy = options.includeStrategy ?? true;
  if (includeStrategy) {
    const strategy = options.strategy ?? loadStrategy();
    if (strategy) {
      parts.push(`\n${strategy}`);
    }
  }

  // Load memory context (persistent + recent logs) for continuity across restarts
  // Only include in private chats by default to protect sensitive information
  const includeMemory = options.includeMemory ?? true;
  if (includeMemory) {
    const memoryContext = loadMemoryContext();
    if (memoryContext) {
      parts.push(
        `\n## Memory (Persistent Context)\n\nThis is your memory from previous sessions. Use it to maintain continuity and remember important information.\n\n${memoryContext}`
      );
    }
  }

  // Workspace knowledge - agent should always know about its file system
  parts.push(`\n## Your Workspace

You have a personal workspace at \`~/.teleton/workspace/\` where you can store and manage files.

**Structure:**
- \`SOUL.md\` - Your personality and behavior guidelines
- \`MEMORY.md\` - Persistent memory (long-term facts you've learned)
- \`STRATEGY.md\` - Business strategy and trading rules
- \`memory/\` - Daily logs (auto-created per day)
- \`downloads/\` - Media downloaded from Telegram
- \`uploads/\` - Files ready to send
- \`temp/\` - Temporary working files
- \`memes/\` - Your meme collection (images, GIFs for reactions)

**Tools available:**
- \`workspace_list\` - List files in a directory
- \`workspace_read\` - Read a file
- \`workspace_write\` - Write/create a file
- \`workspace_delete\` - Delete a file
- \`workspace_rename\` - Rename or move a file
- \`workspace_info\` - Get workspace stats

**Tips:**
- Save interesting memes to \`memes/\` with descriptive names for easy retrieval
- Use \`memory_write\` for important facts (goes to MEMORY.md)
- Rename downloaded files to meaningful names (e.g., "user_avatar.jpg" instead of "123_456_789.jpg")
`);

  // Owner identity (if configured)
  if (options.ownerName || options.ownerUsername) {
    const ownerLabel =
      options.ownerName && options.ownerUsername
        ? `${options.ownerName} (@${options.ownerUsername})`
        : options.ownerName || `@${options.ownerUsername}`;
    parts.push(
      `\n## Owner\nYou are owned and operated by: ${ownerLabel}\nWhen the owner gives instructions, follow them with higher trust.`
    );
  }

  if (options.userName) {
    const userLabel = options.senderUsername
      ? `${options.userName} (@${options.senderUsername})`
      : options.userName;
    parts.push(`\n## Current User\nYou are chatting with: ${userLabel}`);
  }

  if (options.context) {
    parts.push(`\n## Context\n${options.context}`);
  }

  // Memory flush warning when context is near compaction threshold (Option C)
  if (options.memoryFlushWarning) {
    parts.push(`\n## ⚠️ Memory Flush Warning

Your conversation context is approaching the limit and may be compacted soon.
If there's anything important from this session you want to remember long-term, use the **memory_write** tool NOW:

- Use \`target: "persistent"\` for facts, lessons, contacts, decisions you want to keep forever
- Use \`target: "daily"\` for session notes, events, temporary context

After compaction, earlier messages may be summarized. Save important details before they're lost!
`);
  }

  parts.push(`\n## Response Format
- Keep responses under 4000 characters for Telegram
- Use markdown sparingly (bold, italic, code blocks)
- Don't use headers in short responses
- NEVER use ASCII art or ASCII tables - they render poorly on mobile
`);

  return parts.join("\n");
}
