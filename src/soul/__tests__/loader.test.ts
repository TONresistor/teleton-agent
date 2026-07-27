import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>().mockReturnValue(false),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>().mockReturnValue(""),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(args[0] as string),
  readFileSync: (...args: unknown[]) => mockReadFileSync(args[0] as string, args[1] as string),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  realpathSync: vi.fn((p: string) => p),
}));

vi.mock("../../memory/daily-logs.js", () => ({
  readRecentMemory: vi.fn().mockReturnValue(null),
}));

vi.mock("../../utils/sanitize.js", () => ({
  sanitizeForPrompt: vi.fn((v: string) => v),
  sanitizeForContext: vi.fn((v: string) => `[sanitized]${v}`),
}));

import { buildSystemPrompt, loadSoul, loadHeartbeat, clearPromptCache } from "../loader.js";
import { WORKSPACE_PATHS } from "../../workspace/index.js";

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  clearPromptCache();
  mockExistsSync.mockReturnValue(false);
});

// ── Heartbeat Section ────────────────────────────────────────────────────────

describe("buildSystemPrompt() heartbeat section", () => {
  it("includes Heartbeat Protocol section when isHeartbeat: true", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("NO_ACTION");
    expect(prompt).toContain("woken by your periodic heartbeat timer");
  });

  it("does NOT include heartbeat section when isHeartbeat: false", () => {
    const prompt = buildSystemPrompt({ isHeartbeat: false });
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  it("does NOT include heartbeat section when isHeartbeat is omitted", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("## Heartbeat Protocol");
  });

  it("includes HEARTBEAT.md content when file exists", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "Check RSS feeds every hour" : ""
    );

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("Check RSS feeds every hour");
  });

  it("works when HEARTBEAT.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("## Heartbeat Protocol");
    expect(prompt).toContain("_No HEARTBEAT.md found._");
  });

  it("sanitizes HEARTBEAT.md content via sanitizeForContext()", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "user-controlled content" : ""
    );

    const prompt = buildSystemPrompt({ isHeartbeat: true });
    expect(prompt).toContain("[sanitized]user-controlled content");
  });
});

// ── Restructured prompt sections ─────────────────────────────────────────────

describe("buildSystemPrompt() restructured sections", () => {
  it("includes safety reminder as last section (recency bias)", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("<reminder>");
    expect(prompt).toContain("irreversible");
    // Reminder should be at the very end
    const reminderIdx = prompt.lastIndexOf("<reminder>");
    const lastNewline = prompt.lastIndexOf("\n", prompt.length - 2);
    expect(reminderIdx).toBeGreaterThan(lastNewline - 200);
  });

  it("does NOT include removed sections (Active Memory, Runtime tag)", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("## Active Memory");
    expect(prompt).not.toContain("_Runtime:");
  });

  it("includes __SILENT__ in DEFAULT_SOUL personality", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).toContain("__SILENT__");
  });

  it("keeps owner profile and strategy in the global agent context", () => {
    mockExistsSync.mockImplementation(
      (path: string) => path === WORKSPACE_PATHS.USER || path === WORKSPACE_PATHS.STRATEGY
    );
    mockReadFileSync.mockImplementation((path: string) => {
      if (path === WORKSPACE_PATHS.USER) return "private owner profile";
      if (path === WORKSPACE_PATHS.STRATEGY) return "private strategy";
      return "";
    });

    const prompt = buildSystemPrompt({
      ownerName: "Private Owner",
    });

    expect(prompt).toContain("Private Owner");
    expect(prompt).toContain("private owner profile");
    expect(prompt).toContain("private strategy");
  });
});

// ── DEFAULT_SOUL / loadSoul() ────────────────────────────────────────────────

describe("DEFAULT_SOUL / loadSoul()", () => {
  it('default soul contains "autonomous" or "agent"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    const hasAutonomous = soul.toLowerCase().includes("autonomous");
    const hasAgent = soul.toLowerCase().includes("agent");
    expect(hasAutonomous || hasAgent).toBe(true);
  });

  it('default soul does NOT contain old filler "helpful and concise"', () => {
    mockExistsSync.mockReturnValue(false);
    const soul = loadSoul();
    expect(soul).not.toContain("helpful and concise");
  });

  it("custom SOUL.md overrides DEFAULT_SOUL", () => {
    mockExistsSync.mockImplementation((p: string) => (p === WORKSPACE_PATHS.SOUL ? true : false));
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.SOUL ? "I am a custom personality." : ""
    );

    const soul = loadSoul();
    expect(soul).toBe("I am a custom personality.");
    expect(soul).not.toContain("Teleton");
  });
});

// ── loadHeartbeat() ─────────────────────────────────────────────────────────

describe("loadHeartbeat()", () => {
  it("returns file content when HEARTBEAT.md exists", () => {
    mockExistsSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? true : false
    );
    mockReadFileSync.mockImplementation((p: string) =>
      p === WORKSPACE_PATHS.HEARTBEAT ? "Check feeds" : ""
    );

    expect(loadHeartbeat()).toBe("Check feeds");
  });

  it("returns null when HEARTBEAT.md does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    expect(loadHeartbeat()).toBeNull();
  });
});
