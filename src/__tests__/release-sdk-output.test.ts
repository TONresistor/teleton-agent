import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

interface ReleaseWorkflow {
  jobs: {
    "publish-sdk": {
      steps: { id?: string; run?: string; if?: string }[];
    };
  };
}

const workflow = parse(
  readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8")
) as ReleaseWorkflow;
const sdkSteps = workflow.jobs["publish-sdk"].steps;
const checkScript = sdkSteps.find((step) => step.id === "check")?.run;
const version = "2.1.0";
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "teleton-sdk-release-"));
  mkdirSync(join(directory, "packages/sdk"), { recursive: true });
  writeFileSync(join(directory, "packages/sdk/package.json"), JSON.stringify({ version }));
  writeFileSync(join(directory, "output"), "");
  writeFileSync(
    join(directory, "npm"),
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TELETON_TEST_NPM_CALLS, JSON.stringify(args) + "\\n");
if (JSON.stringify(args) !== JSON.stringify(["view", "@teleton-agent/sdk", "versions", "--json"])) process.exit(99);
if (process.env.TELETON_TEST_NPM_FAILURE === "true") {
  console.error("Registry unavailable");
  process.exit(1);
}
console.log(process.env.TELETON_TEST_NPM_VERSIONS);
`,
    { mode: 0o755 }
  );
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function checkVersion(versions: string, registryFailure = false) {
  expect(checkScript).toBeTypeOf("string");
  writeFileSync(join(directory, "check.sh"), checkScript!);
  const result = spawnSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", "check.sh"], {
    cwd: directory,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      GITHUB_OUTPUT: join(directory, "output"),
      TELETON_TEST_NPM_CALLS: join(directory, "npm-calls"),
      TELETON_TEST_NPM_VERSIONS: versions,
      TELETON_TEST_NPM_FAILURE: String(registryFailure),
    },
  });
  // These outputs are single-line values. Reject malformed lines as the Actions runner does.
  const outputs: Record<string, string> = {};
  const contents = readFileSync(join(directory, "output"), "utf8");
  for (const line of contents.trimEnd().split("\n").filter(Boolean)) {
    expect(line).toMatch(/^[A-Za-z_][A-Za-z0-9_]*=[^\r\n]*$/);
    const separator = line.indexOf("=");
    outputs[line.slice(0, separator)] = line.slice(separator + 1);
  }
  expect(readFileSync(join(directory, "npm-calls"), "utf8").trim()).toBe(
    JSON.stringify(["view", "@teleton-agent/sdk", "versions", "--json"])
  );
  for (const step of sdkSteps.filter((step) => step.run?.includes("npm publish"))) {
    expect(step.if).toBe("steps.check.outputs.publish == 'true'");
  }
  return { result, outputs };
}

describe("SDK release version check", () => {
  it("skips an existing version from a multiline registry array with valid Actions outputs", () => {
    const { result, outputs } = checkVersion(JSON.stringify(["2.0.0", version], null, 2));
    expect(result.status).toBe(0);
    expect(outputs).toMatchObject({ local: version, publish: "false" });
  });

  it("publishes a new version from a multiline registry array with valid Actions outputs", () => {
    const { result, outputs } = checkVersion(JSON.stringify(["1.0.0", "2.0.0"], null, 2));
    expect(result.status).toBe(0);
    expect(outputs).toMatchObject({ local: version, publish: "true" });
  });

  it("also skips an existing version when npm returns a single version string", () => {
    const { result, outputs } = checkVersion(JSON.stringify(version));
    expect(result.status).toBe(0);
    expect(outputs.publish).toBe("false");
  });

  it("fails closed when the registry query fails without enabling publication", () => {
    const { result, outputs } = checkVersion("", true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Registry unavailable");
    expect(outputs.publish).toBeUndefined();
  });
});
