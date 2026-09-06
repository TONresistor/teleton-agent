import { writePrivateFileAtomic } from "../utils/atomic-file.js";
// src/memory/core-blocks.ts
// Structured core memory: named blocks with character limits

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { WORKSPACE_ROOT } from "../workspace/index.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("CoreMemory");

const CORE_MEMORY_FILE = join(WORKSPACE_ROOT, "CORE_MEMORY.json");
const MEMORY_MD_PATH = join(WORKSPACE_ROOT, "MEMORY.md");

// In-process cache — invalidated on every save
let _cache: Record<BlockName, string> | null = null;

export const BLOCK_NAMES = ["identity", "preferences", "lessons", "goals", "contacts"] as const;
export type BlockName = (typeof BLOCK_NAMES)[number];

const DEFAULT_MAX_SIZE = 500;

const BLOCK_LIMITS: Record<BlockName, number> = {
  identity: 600,
  preferences: 500,
  lessons: 800,
  goals: 400,
  contacts: 600,
};

export interface CoreMemoryData {
  blocks: Record<BlockName, string>;
}

function emptyBlocks(): Record<BlockName, string> {
  return Object.fromEntries(BLOCK_NAMES.map((n) => [n, ""])) as Record<BlockName, string>;
}

function getLimit(block: BlockName): number {
  return BLOCK_LIMITS[block] ?? DEFAULT_MAX_SIZE;
}

/**
 * Migrate from MEMORY.md into structured blocks (best-effort)
 */
function migrateFromMemoryMd(): Record<BlockName, string> {
  const blocks = emptyBlocks();

  if (!existsSync(MEMORY_MD_PATH)) return blocks;

  const content = readFileSync(MEMORY_MD_PATH, "utf-8");
  const lines = content.split("\n");

  let currentSection = "";
  const sectionContent: Record<string, string[]> = {};

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(?:🤖|🎯|👥|📚|🐕)?\s*(.+)/);
    if (headerMatch) {
      currentSection = headerMatch[1].trim().toLowerCase();
      if (!sectionContent[currentSection]) sectionContent[currentSection] = [];
      continue;
    }
    if (currentSection) {
      sectionContent[currentSection]?.push(line);
    }
  }

  const joinSection = (key: string): string => {
    const lines = sectionContent[key];
    if (!lines) return "";
    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/_Added:.*_/g, "")
      .trim();
  };

  blocks.identity = joinSection("identity");
  blocks.goals = joinSection("the goal: plush pepe 🐸") || joinSection("the goal");
  blocks.contacts = joinSection("people");
  blocks.preferences = joinSection("philosophy");

  // Lessons: merge "key lessons" + "heartbeat tasks"
  const lessons = [joinSection("key lessons"), joinSection("heartbeat tasks")].filter(Boolean);
  blocks.lessons = lessons.join("\n\n");

  // Trim blocks to their limits
  for (const name of BLOCK_NAMES) {
    const limit = getLimit(name);
    if (blocks[name].length > limit) {
      blocks[name] = blocks[name].slice(0, limit);
    }
  }

  log.info("Migrated MEMORY.md into core memory blocks");
  return blocks;
}

/**
 * Load all core memory blocks from disk (or migrate from MEMORY.md on first load)
 */
export function loadCoreMemory(): Record<BlockName, string> {
  if (_cache) return _cache;
  if (existsSync(CORE_MEMORY_FILE)) {
    try {
      const raw = readFileSync(CORE_MEMORY_FILE, "utf-8");
      const data: CoreMemoryData = JSON.parse(raw);
      // Ensure all block names exist (forward compat)
      const blocks = emptyBlocks();
      for (const name of BLOCK_NAMES) {
        if (data.blocks[name]) blocks[name] = data.blocks[name];
      }
      _cache = blocks;
      return blocks;
    } catch (err) {
      log.error({ err }, "Failed to read CORE_MEMORY.json, falling back to migration");
    }
  }

  // First load: migrate from MEMORY.md
  const blocks = migrateFromMemoryMd();
  saveCoreMemory(blocks);
  _cache = blocks;
  return blocks;
}

function saveCoreMemory(blocks: Record<BlockName, string>): void {
  const data: CoreMemoryData = { blocks };
  writePrivateFileAtomic(CORE_MEMORY_FILE, JSON.stringify(data, null, 2));
  _cache = blocks;
}

/**
 * Overwrite a block's content entirely
 */
export function updateBlock(blockName: string, content: string): void {
  if (!BLOCK_NAMES.includes(blockName as BlockName)) {
    throw new Error(`Unknown block: ${blockName}. Valid: ${BLOCK_NAMES.join(", ")}`);
  }
  const name = blockName as BlockName;
  const limit = getLimit(name);
  if (content.length > limit) {
    throw new Error(`Content exceeds block limit (${content.length}/${limit} chars)`);
  }

  const blocks = { ...loadCoreMemory() };
  blocks[name] = content;
  saveCoreMemory(blocks);
  log.info(`Core memory block '${name}' updated (${content.length} chars)`);
}

/**
 * Append content to a block (with size check)
 */
export function appendToBlock(blockName: string, content: string): void {
  if (!BLOCK_NAMES.includes(blockName as BlockName)) {
    throw new Error(`Unknown block: ${blockName}. Valid: ${BLOCK_NAMES.join(", ")}`);
  }
  const name = blockName as BlockName;
  const blocks = { ...loadCoreMemory() };
  const separator = blocks[name].length > 0 ? "\n" : "";
  const newContent = blocks[name] + separator + content;
  const limit = getLimit(name);
  if (newContent.length > limit) {
    throw new Error(
      `Appending would exceed block limit (${newContent.length}/${limit} chars). Use updateBlock to replace content.`
    );
  }

  blocks[name] = newContent;
  saveCoreMemory(blocks);
  log.info(`Core memory block '${name}' appended (now ${newContent.length} chars)`);
}

/**
 * Remove a specific line/entry from a block (first match of substring)
 */
export function deleteFromBlock(blockName: string, key: string): void {
  if (!BLOCK_NAMES.includes(blockName as BlockName)) {
    throw new Error(`Unknown block: ${blockName}. Valid: ${BLOCK_NAMES.join(", ")}`);
  }
  const name = blockName as BlockName;
  const blocks = { ...loadCoreMemory() };
  const lines = blocks[name].split("\n");
  const idx = lines.findIndex((l) => l.includes(key));
  if (idx === -1) {
    throw new Error(`No line matching "${key}" found in block '${name}'`);
  }
  lines.splice(idx, 1);
  blocks[name] = lines.join("\n").trim();
  saveCoreMemory(blocks);
  log.info(`Deleted entry from core memory block '${name}'`);
}

/**
 * Format all blocks as readable sections for the system prompt
 */
export function getCoreMemoryForPrompt(): string {
  const blocks = loadCoreMemory();
  const sections: string[] = [];

  for (const name of BLOCK_NAMES) {
    if (!blocks[name]) continue;
    const label = name.charAt(0).toUpperCase() + name.slice(1);
    sections.push(`### ${label}\n${blocks[name]}`);
  }

  if (sections.length === 0) return "";
  return sections.join("\n\n");
}
