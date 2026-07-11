import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_ROOT = "/tmp/teleton-doctor-test";

vi.mock("../../../workspace/paths.js", () => ({
  TELETON_ROOT: "/tmp/teleton-doctor-test",
}));

vi.mock("../../../providers/codex-credentials.js", () => ({
  getCodexApiKey: vi.fn(() => "test-token"),
  isCodexTokenValid: vi.fn(() => true),
}));

import { doctorCommand } from "../doctor.js";

describe("doctor command", () => {
  beforeEach(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true });
    mkdirSync(join(TEST_ROOT, "workspace"), { recursive: true });

    writeFileSync(
      join(TEST_ROOT, "config.yaml"),
      [
        "agent:",
        "  provider: codex",
        "  model: gpt-5.6-terra",
        "telegram:",
        "  api_id: 1",
        "  api_hash: test-hash",
        '  phone: "+10000000000"',
        "  admin_ids: [123]",
      ].join("\n")
    );
    writeFileSync(join(TEST_ROOT, "telegram_session.txt"), "session");
    writeFileSync(join(TEST_ROOT, "wallet.json"), JSON.stringify({ address: "EQtestaddress" }));
    writeFileSync(join(TEST_ROOT, "memory.db"), "db");
    writeFileSync(join(TEST_ROOT, "workspace", "SOUL.md"), "# Soul\n");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(TEST_ROOT, { recursive: true, force: true });
  });

  it("checks SOUL.md in the workspace subdirectory", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await doctorCommand();

    const output = consoleLog.mock.calls.flat().join("\n");
    expect(output).toContain("SOUL.md: 0.0 KB");
    expect(output).not.toContain("SOUL.md: Not found");
  });
});
