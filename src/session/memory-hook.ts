import { writeFile, mkdir, readdir, readFile } from "fs/promises";
import { mkdirSync, renameSync } from "fs";
import { join } from "path";
import { complete, type Context } from "@earendil-works/pi-ai/compat";
import {
  summarizeViaClaude,
  summarizeWithFallback,
  formatMessagesForSummary,
} from "../memory/ai-summarization.js";
import { getUtilityModel } from "../agent/client.js";
import type { SupportedProvider } from "../config/providers.js";
import { createLogger } from "../utils/logger.js";
import {
  SESSION_SLUG_RECENT_MESSAGES,
  SESSION_SLUG_MAX_TOKENS,
  DEFAULT_MAX_SUMMARY_TOKENS,
  DEFAULT_CONTEXT_WINDOW,
} from "../constants/limits.js";

const log = createLogger("Session");

/**
 * Generate a semantic slug for a session using LLM.
 * Creates a short, descriptive identifier based on conversation content.
 */
async function generateSlugViaClaude(params: {
  messages: Context["messages"];
  apiKey: string;
  provider?: SupportedProvider;
  utilityModel?: string;
}): Promise<string> {
  const provider = params.provider || "anthropic";
  const model = getUtilityModel(provider, params.utilityModel);

  const formatted = formatMessagesForSummary(params.messages.slice(-SESSION_SLUG_RECENT_MESSAGES));

  if (!formatted.trim()) {
    return "empty-session";
  }

  try {
    const context: Context = {
      messages: [
        {
          role: "user",
          content: `Generate a short, descriptive slug (2-4 words, kebab-case) for this conversation.
Examples: "gift-transfer-fix", "context-overflow-debug", "telegram-integration"

Conversation:
${formatted}

Slug:`,
          timestamp: Date.now(),
        },
      ],
    };

    const response = await complete(model, context, {
      apiKey: params.apiKey,
      maxTokens: SESSION_SLUG_MAX_TOKENS,
    });

    const textContent = response.content.find((block) => block.type === "text");
    const slug = textContent?.type === "text" ? textContent.text.trim() : "";

    return (
      slug
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 50) || "session"
    );
  } catch (error) {
    log.warn({ err: error }, "Slug generation failed, using fallback");
    const now = new Date();
    return `session-${now.getHours().toString().padStart(2, "0")}${now.getMinutes().toString().padStart(2, "0")}`;
  }
}

/**
 * Save session memory to dated markdown file.
 * Creates audit trail of session transitions for human review.
 */
export async function saveSessionMemory(params: {
  oldSessionId: string;
  newSessionId: string;
  context: Context;
  chatId: string;
  apiKey: string;
  provider?: SupportedProvider;
  utilityModel?: string;
}): Promise<void> {
  try {
    const { TELETON_ROOT } = await import("../workspace/paths.js");
    const memoryDir = join(TELETON_ROOT, "memory");
    await mkdir(memoryDir, { recursive: true });

    const now = new Date();
    const dateStr = now.toISOString().split("T")[0];

    log.info("Generating semantic slug for session memory...");
    const slug = await generateSlugViaClaude({
      messages: params.context.messages,
      apiKey: params.apiKey,
      provider: params.provider,
      utilityModel: params.utilityModel,
    });

    const filename = `${dateStr}-${slug}.md`;
    const filepath = join(memoryDir, filename);

    const timeStr = now.toISOString().split("T")[1].split(".")[0];

    log.info("Generating session summary...");
    let summary: string;
    try {
      summary = await summarizeViaClaude({
        messages: params.context.messages,
        apiKey: params.apiKey,
        maxSummaryTokens: DEFAULT_MAX_SUMMARY_TOKENS,
        customInstructions:
          "Summarize this session comprehensively. Include key topics, decisions made, problems solved, and important context.",
        provider: params.provider,
        utilityModel: params.utilityModel,
      });
    } catch (error) {
      log.warn({ err: error }, "Session summary generation failed");
      summary = `Session contained ${params.context.messages.length} messages. Summary generation failed.`;
    }

    const content = `# Session Memory: ${dateStr} ${timeStr} UTC

## Metadata

- **Old Session ID**: \`${params.oldSessionId}\`
- **New Session ID**: \`${params.newSessionId}\`
- **Chat ID**: \`${params.chatId}\`
- **Timestamp**: ${now.toISOString()}
- **Message Count**: ${params.context.messages.length}

## Session Summary

${summary}

## Context

This session was compacted and migrated to a new session ID. The summary above preserves key information for continuity.

---

*Generated automatically by Teleton-AI session memory hook*
`;

    await writeFile(filepath, content, "utf-8");

    // Append summary to daily log so the agent sees it in the prompt (yesterday+today)
    const { writeSessionEndSummary } = await import("../memory/daily-logs.js");
    writeSessionEndSummary(summary, "compaction");

    // Index in knowledge_fts so memory_search and RAG can find it later
    const { getKnowledgeIndexer } = await import("../memory/agent/knowledge.js");
    getKnowledgeIndexer()
      ?.indexFile(filepath)
      .catch(() => {});

    const relPath = filepath.replace(TELETON_ROOT, "~/.teleton");
    log.info(`Session memory saved: ${relPath}`);
  } catch (error) {
    log.error({ err: error }, "Failed to save session memory");
  }
}

const CONSOLIDATION_THRESHOLD = 20;
const CONSOLIDATION_AGE_DAYS = 7;
const CONSOLIDATION_FALLBACK_BATCH = 10;
const CONSOLIDATION_MAX_TOKENS = 4000;
const CONSOLIDATION_MIN_CLUSTER_SIZE = 2;

/**
 * Consolidate old session memory files when they exceed a threshold.
 *
 * - Only considers files older than 7 days.
 * - Clusters files by keyword overlap (slug words + first heading words).
 * - Consolidates each thematic cluster separately.
 * - Soft-deletes originals by moving them to an archived/ subdirectory.
 * - Falls back to chronological grouping if no clusters are found.
 */
export async function consolidateOldMemoryFiles(params: {
  apiKey: string;
  provider?: SupportedProvider;
  utilityModel?: string;
}): Promise<{ consolidated: number }> {
  try {
    const { TELETON_ROOT } = await import("../workspace/paths.js");
    const memoryDir = join(TELETON_ROOT, "memory");
    const archiveDir = join(memoryDir, "archived");

    let entries: string[];
    try {
      entries = await readdir(memoryDir);
    } catch {
      return { consolidated: 0 };
    }

    // Session files match YYYY-MM-DD-slug.md (not plain YYYY-MM-DD.md daily logs, not consolidated-)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CONSOLIDATION_AGE_DAYS);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const sessionFiles = entries
      .filter(
        (f) =>
          /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f) &&
          !f.startsWith("consolidated-") &&
          f.slice(0, 10) < cutoffStr
      )
      .sort();

    if (sessionFiles.length < CONSOLIDATION_THRESHOLD) {
      return { consolidated: 0 };
    }

    // Extract keywords from slug + first heading for each file
    const fileKeywords: Array<{ file: string; keywords: Set<string> }> = [];
    for (const file of sessionFiles) {
      const slug = file.slice(11).replace(/\.md$/, ""); // strip YYYY-MM-DD-
      const slugWords = slug.split("-").filter((w) => w.length > 3);

      let headingWords: string[] = [];
      try {
        const text = await readFile(join(memoryDir, file), "utf-8");
        const firstHeading = text.split("\n").find((l) => l.startsWith("#")) ?? "";
        headingWords = firstHeading
          .replace(/^#+\s*/, "")
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length > 3);
      } catch {
        // keep empty — slug words alone are enough
      }

      fileKeywords.push({ file, keywords: new Set([...slugWords, ...headingWords]) });
    }

    // Greedy keyword-overlap clustering: group files sharing ≥1 keyword
    const assigned = new Set<string>();
    const clusters: string[][] = [];

    for (let i = 0; i < fileKeywords.length; i++) {
      if (assigned.has(fileKeywords[i].file)) continue;
      const cluster: string[] = [fileKeywords[i].file];
      assigned.add(fileKeywords[i].file);

      for (let j = i + 1; j < fileKeywords.length; j++) {
        if (assigned.has(fileKeywords[j].file)) continue;
        const hasOverlap = [...fileKeywords[i].keywords].some((k) =>
          fileKeywords[j].keywords.has(k)
        );
        if (hasOverlap) {
          cluster.push(fileKeywords[j].file);
          assigned.add(fileKeywords[j].file);
        }
      }

      if (cluster.length >= CONSOLIDATION_MIN_CLUSTER_SIZE) {
        clusters.push(cluster);
      }
    }

    // Fallback: no thematic clusters found — use oldest N files chronologically
    if (clusters.length === 0) {
      log.info("No thematic clusters found, falling back to chronological grouping");
      clusters.push(sessionFiles.slice(0, CONSOLIDATION_FALLBACK_BATCH));
    }

    // Ensure archive directory exists
    mkdirSync(archiveDir, { recursive: true });

    let totalConsolidated = 0;

    for (const cluster of clusters) {
      log.info(
        `Consolidating cluster of ${cluster.length} files: ${cluster.slice(0, 3).join(", ")}${cluster.length > 3 ? "…" : ""}`
      );

      const contents: string[] = [];
      for (const file of cluster) {
        const text = await readFile(join(memoryDir, file), "utf-8");
        contents.push(`--- ${file} ---\n${text}`);
      }

      const combined = contents.join("\n\n");
      const sourceList = cluster.map((f) => `- ${f}`).join("\n");

      let summary: string;
      try {
        const result = await summarizeWithFallback({
          messages: [{ role: "user", content: combined, timestamp: Date.now() }],
          apiKey: params.apiKey,
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxSummaryTokens: CONSOLIDATION_MAX_TOKENS,
          customInstructions: `Consolidate these session memories into a single comprehensive summary.
Source files:
${sourceList}

Preserve key facts, decisions, patterns, and important context. Remove redundancy. Organize by topic. You may reference source file names when relevant.`,
          provider: params.provider,
          utilityModel: params.utilityModel,
        });
        summary = result.summary;
      } catch (error) {
        log.warn({ err: error }, "Consolidation summary failed for cluster, skipping");
        continue;
      }

      const dateOf = (f: string) => f.slice(0, 10);
      const dateRange = `${dateOf(cluster[0])}_to_${dateOf(cluster[cluster.length - 1])}`;
      const outFile = `consolidated-${dateRange}.md`;
      const outContent = `# Consolidated Session Memories

## Metadata

- **Period**: ${cluster[0]} → ${cluster[cluster.length - 1]}
- **Source Files** (${cluster.length}):
${sourceList}

## Summary

${summary}

---

*Consolidated from ${cluster.length} session files. Originals archived in memory/archived/.*
`;

      await writeFile(join(memoryDir, outFile), outContent, "utf-8");

      // Soft-delete: move originals to archive instead of deleting
      for (const file of cluster) {
        renameSync(join(memoryDir, file), join(archiveDir, file));
      }

      totalConsolidated += cluster.length;
      log.info(`Consolidated ${cluster.length} files → ${outFile}`);
    }

    return { consolidated: totalConsolidated };
  } catch (error) {
    log.error({ err: error }, "Memory consolidation failed");
    return { consolidated: 0 };
  }
}
