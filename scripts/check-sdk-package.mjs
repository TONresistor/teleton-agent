import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdkDir = join(rootDir, "packages", "sdk");
const packageJson = JSON.parse(readFileSync(join(sdkDir, "package.json"), "utf8"));
const tempDir = mkdtempSync(join(tmpdir(), "teleton-sdk-package-"));

function linkDependency(relativePath) {
  const source = join(rootDir, "node_modules", relativePath);
  if (!existsSync(source)) {
    throw new Error(`SDK package check requires installed dependency: ${relativePath}`);
  }
  const target = join(tempDir, "consumer", "node_modules", relativePath);
  mkdirSync(dirname(target), { recursive: true });
  symlinkSync(source, target, "dir");
}

try {
  const packResult = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", tempDir], {
      cwd: sdkDir,
      encoding: "utf8",
    })
  )[0];

  const paths = new Set(packResult.files.map((file) => file.path));
  for (const required of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.js",
    "dist/index.d.ts",
  ]) {
    if (!paths.has(required)) throw new Error(`SDK tarball is missing ${required}`);
  }
  if ([...paths].some((path) => path.startsWith("src/") || path.includes("__tests__"))) {
    throw new Error("SDK tarball contains source or test files");
  }

  const consumerDir = join(tempDir, "consumer");
  const installedSdkDir = join(consumerDir, "node_modules", "@teleton-agent", "sdk");
  mkdirSync(installedSdkDir, { recursive: true });
  execFileSync(
    "tar",
    ["-xzf", join(tempDir, packResult.filename), "--strip-components=1", "-C", installedSdkDir],
    { stdio: "inherit" }
  );

  linkDependency("@ton/core");
  linkDependency("better-sqlite3");
  linkDependency("@types/better-sqlite3");
  linkDependency("@types/node");

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify({ name: "sdk-consumer-check", private: true, type: "module" })
  );
  writeFileSync(
    join(consumerDir, "index.ts"),
    `import {
  PLUGIN_HOOK_NAMES,
  TOOL_CATEGORIES,
  TOOL_SCOPES,
  PluginSDKError,
  SDK_VERSION,
  type PluginManifest,
  type PluginSDK,
  type SimpleToolDef,
  type StartContext,
} from "@teleton-agent/sdk";

const manifest: PluginManifest = {
  name: "consumer-check",
  version: "1.0.0",
  sdkVersion: "^2.0.0",
  hooks: [{ name: "agent:start", priority: 10 }],
};

const tools: SimpleToolDef<{ name: string }>[] = [{
  name: "consumer_hello",
  description: "Consumer compilation check",
  parameters: { type: "object" },
  scope: "allowlist",
  category: "action",
  requiresApproval: true,
  async execute(params, context) {
    return { success: true, data: { name: params.name, chatId: context.chatId } };
  },
}];

export function acceptsSdk(sdk: PluginSDK): string {
  return sdk.version;
}

export function start(context: StartContext): void {
  void context.sdk.telegram.isAvailable();
  void context.db;
}

void manifest;
void tools;
void PLUGIN_HOOK_NAMES;
void TOOL_CATEGORIES;
void TOOL_SCOPES;
void SDK_VERSION;
void new PluginSDKError("consumer check", "OPERATION_FAILED");
`
  );

  execFileSync(
    join(rootDir, "node_modules", ".bin", "tsc"),
    [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "false",
      "--target",
      "ES2022",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--types",
      "node",
      join(consumerDir, "index.ts"),
    ],
    { cwd: consumerDir, stdio: "inherit" }
  );

  const runtime = await import(pathToFileURL(join(installedSdkDir, "dist", "index.js")).href);
  if (runtime.SDK_VERSION !== packageJson.version) {
    throw new Error(
      `SDK runtime version ${runtime.SDK_VERSION} does not match package ${packageJson.version}`
    );
  }
  if (runtime.PLUGIN_HOOK_NAMES.length !== 13) {
    throw new Error("SDK runtime hook contract is incomplete");
  }

  process.stdout.write(`SDK package verified (${packageJson.version}, ${packResult.size} bytes)\n`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
