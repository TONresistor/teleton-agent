import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const FORBIDDEN_LOG_FRAGMENTS: Record<string, string[]> = {
  "src/webui/server.ts": ["auth/exchange?token=${this.authToken}"],
  "src/agent/runtime.ts": [
    "Formatted message: ${formattedMessage",
    "const preview = formattedMessage",
    "original: searchQuery",
  ],
  "src/agent/tools/search/tool-search.ts": ['query="${query}"'],
  "src/telegram/client.ts": ["message?.substring(0, 30)"],
  "src/telegram/handlers.ts": ["transcriptionText?.substring"],
  "src/agent/tools/telegram/media/transcribe-audio.ts": ["result.text?.substring"],
  "src/scheduled-tasks.ts": ["Invalid task format: ${message.text}"],
  "src/telegram/task-dependency-resolver.ts": [
    "Cancelled task ${depId}: ${task.description}",
    "Triggering dependent task: ${task.description}",
  ],
  "src/agent/tools/telegram/messaging/inline-send.ts": ['query="${query}" index'],
  "src/agent/tools/telegram/chats/edit-channel-info.ts": ["edit_channel_info: ${channel.title}"],
};

describe("sensitive logging guard", () => {
  for (const [relativePath, fragments] of Object.entries(FORBIDDEN_LOG_FRAGMENTS)) {
    it(`${relativePath} does not log user content or credentials`, () => {
      const source = readFileSync(`${ROOT}${relativePath}`, "utf8");
      for (const fragment of fragments) {
        expect(source, `forbidden log fragment: ${fragment}`).not.toContain(fragment);
      }
    });
  }
});
