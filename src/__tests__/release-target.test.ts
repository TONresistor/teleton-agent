import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let directory: string;
const releaseScript = fileURLToPath(
  new URL("../../scripts/check-release-target.mjs", import.meta.url)
);
const fixtureCommit = "a".repeat(40);
const staleCommit = "b".repeat(40);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-release-target-"));
  writeFileSync(
    join(directory, "git"),
    `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "fetch") process.exit(0);
if (args[0] !== "rev-parse") process.exit(1);
const ref = args[1];
const name = ref === "HEAD" ? "TELETON_TEST_HEAD" : ref === "origin/main" ? "TELETON_TEST_MAIN" : "TELETON_TEST_TAG";
console.log(process.env[name]);
`,
    { mode: 0o755 }
  );
  writeFileSync(
    join(directory, "gh"),
    `#!/usr/bin/env node
console.log(process.env.TELETON_TEST_RUNS);
`,
    { mode: 0o755 }
  );
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function ciRun(overrides: Record<string, unknown> = {}) {
  return {
    head_sha: fixtureCommit,
    head_branch: "main",
    run_number: 1,
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
}

function verify(overrides: Record<string, string> = {}, runs = [ciRun()]): string {
  return execFileSync(process.execPath, [releaseScript], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      GITHUB_REPOSITORY: "test/repository",
      GITHUB_REF_NAME: "v1.0.0",
      TELETON_TEST_HEAD: fixtureCommit,
      TELETON_TEST_MAIN: fixtureCommit,
      TELETON_TEST_TAG: fixtureCommit,
      TELETON_TEST_RUNS: JSON.stringify({ workflow_runs: runs }),
      ...overrides,
    },
  });
}

describe("release target guard with local command fixtures", () => {
  it("accepts a tag on current main with completed successful CI", () => {
    expect(verify()).toContain("Release target verified");
  });

  it("rejects branch events before running release commands", () => {
    expect(() => verify({ GITHUB_REF_NAME: "dev" })).toThrow("Expected a GitHub version tag event");
  });

  it("rejects a tag resolving to a different checkout", () => {
    expect(() => verify({ TELETON_TEST_TAG: staleCommit })).toThrow(
      "Release tag does not resolve to the checked-out commit"
    );
  });

  it("rejects a release commit outside current main", () => {
    expect(() => verify({ TELETON_TEST_MAIN: staleCommit })).toThrow(
      "Release tag must target the current main commit"
    );
  });

  it("rejects missing CI and CI for a different commit or branch", () => {
    for (const runs of [[], [ciRun({ head_sha: staleCommit })], [ciRun({ head_branch: "dev" })]]) {
      expect(() => verify({}, runs)).toThrow("must have completed successfully");
    }
  });

  it("rejects a newer pending or failed CI even when an older run passed", () => {
    for (const latest of [
      ciRun({ run_number: 2, status: "in_progress", conclusion: null }),
      ciRun({ run_number: 2, conclusion: "failure" }),
    ]) {
      expect(() => verify({}, [ciRun(), latest])).toThrow("must have completed successfully");
    }
  });

  it("accepts the most recent successful CI independently of API ordering", () => {
    expect(
      verify({}, [ciRun({ run_number: 4 }), ciRun({ run_number: 2, conclusion: "failure" })])
    ).toContain("Release target verified");
  });
});
