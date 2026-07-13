import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@earendil-works/pi-ai";

const mocks = vi.hoisted(() => ({
  appendFile: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue(""),
  unlinkSync: vi.fn(),
  renameSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  statSync: vi.fn(),
}));
vi.mock("fs/promises", () => ({ appendFile: mocks.appendFile }));
vi.mock("../../workspace/paths.js", () => ({ TELETON_ROOT: "/tmp/teleton-transcript-test" }));

import {
  appendToTranscript,
  flushTranscript,
  readTranscript,
  sanitizeTranscriptMessages,
} from "../transcript.js";

const userMessage = (content: string): Message => ({
  role: "user",
  content,
  timestamp: Date.now(),
});

describe("transcript persistence", () => {
  beforeEach(() => mocks.appendFile.mockReset());

  it("serializes writes for each session and seeds the cache on first append", async () => {
    let releaseFirst!: () => void;
    mocks.appendFile
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValueOnce(undefined);

    appendToTranscript("ordered", userMessage("first"));
    appendToTranscript("ordered", userMessage("second"));

    await vi.waitFor(() => expect(mocks.appendFile).toHaveBeenCalledTimes(1));
    expect(readTranscript("ordered").map((message) => message.content)).toEqual([
      "first",
      "second",
    ]);

    releaseFirst();
    await flushTranscript("ordered");

    expect(mocks.appendFile).toHaveBeenCalledTimes(2);
    const persisted = mocks.appendFile.mock.calls.map((call) => JSON.parse(call[1] as string));
    expect(persisted.map((message) => message.content)).toEqual(["first", "second"]);
  });

  it("drops an incomplete assistant tool-call batch after a crash", () => {
    const incomplete = {
      role: "assistant" as const,
      content: [{ type: "toolCall" as const, id: "call-1", name: "test", arguments: {} }],
      stopReason: "toolUse" as const,
      timestamp: Date.now(),
    };

    expect(sanitizeTranscriptMessages([userMessage("before"), incomplete])).toEqual([
      expect.objectContaining({ role: "user", content: "before" }),
    ]);
  });
});
