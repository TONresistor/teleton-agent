import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tools as dedustTools } from "../../agent/tools/dedust/index.js";
import { tools as dnsTools } from "../../agent/tools/dns/index.js";
import { tools as journalTools } from "../../agent/tools/journal/index.js";
import { tools as stonfiTools } from "../../agent/tools/stonfi/index.js";
import { tools as telegramTools } from "../../agent/tools/telegram/index.js";
import { tools as tonTools } from "../../agent/tools/ton/index.js";
import { tools as webTools } from "../../agent/tools/web/index.js";
import { tools as workspaceTools } from "../../agent/tools/workspace/index.js";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const CURRENT_PRODUCT_PATHS = [
  "README.md",
  "GETTING_STARTED.md",
  "config.example.yaml",
  "docs/configuration.md",
  "docs/plugins.md",
  "docs/telegram-setup.md",
  "src/agent/tools/telegram/gifts/get-available-gifts.ts",
  "src/agent/tools/telegram/gifts/set-collectible-price.ts",
  "src/agent/tools/telegram/messaging/inline-send.ts",
  "src/telegram/bridges/bot.ts",
  "src/webui/__tests__/setup-routes.test.ts",
  "web/src/components/setup/ConfigStep.tsx",
  "web/src/components/setup/SetupContext.tsx",
  "web/src/lib/api.ts",
  "web/src/pages/Config.tsx",
];

function docsSdkFiles(): string[] {
  const root = join(ROOT, "docs-sdk");
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => [".html", ".md", ".txt"].includes(extname(path)));
}

function usesUnsupportedLightLottieFeature(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesUnsupportedLightLottieFeature);
  if (typeof value !== "object" || value === null) return false;

  const entry = value as Record<string, unknown>;
  if (typeof entry.x === "string") return true; // Expressions require eval in the full player.
  if (Array.isArray(entry.ef) && entry.ef.length > 0) return true;
  if (entry.ty === 2) return true; // Image layers are excluded from the light player.
  return Object.values(entry).some(usesUnsupportedLightLottieFeature);
}

describe("current product surfaces", () => {
  it("keeps documented built-in category counts anchored to the registry", () => {
    const baseToolCount =
      telegramTools.length +
      tonTools.length +
      dnsTools.length +
      stonfiTools.length +
      dedustTools.length +
      journalTools.length +
      workspaceTools.length +
      webTools.length +
      1; // tool_search is registered after the category arrays.

    expect({
      base: baseToolCount,
      telegram: telegramTools.length,
      telegramUserMode: telegramTools.filter((entry) => entry.mode !== "bot").length,
      telegramBotMode: telegramTools.filter((entry) => entry.mode !== "user").length,
      ton: tonTools.length,
      dns: dnsTools.length,
      stonfi: stonfiTools.length,
      dedust: dedustTools.length,
      journal: journalTools.length,
      workspace: workspaceTools.length,
      web: webTools.length,
    }).toEqual({
      base: 128,
      telegram: 83,
      telegramUserMode: 80,
      telegramBotMode: 17,
      ton: 15,
      dns: 8,
      stonfi: 5,
      dedust: 5,
      journal: 3,
      workspace: 6,
      web: 2,
    });

    expect(readFileSync(join(ROOT, "README.md"), "utf8")).toContain(
      `${baseToolCount} always-registered tools`
    );
    expect(readFileSync(join(ROOT, "GETTING_STARTED.md"), "utf8")).toContain(
      `**${baseToolCount} always-registered tools**`
    );
    expect(readFileSync(join(ROOT, "docs-sdk/pages/index.html"), "utf8")).toContain(
      `${baseToolCount} base tools plus 5 optional system tools`
    );
  });

  it("documents the exact Telegram registry without removed or missing tools", () => {
    const source = readFileSync(join(ROOT, "docs-sdk/pages/tools-telegram.html"), "utf8");
    const documented = [...source.matchAll(/<h3 id="([^"]+)"/g)].map((match) => match[1]).sort();
    const registered = telegramTools.map((entry) => entry.tool.name).sort();

    expect(documented).toEqual(registered);
  });

  it("does not advertise the removed deals module or dead strategy command", () => {
    for (const relativePath of CURRENT_PRODUCT_PATHS) {
      const source = readFileSync(join(ROOT, relativePath), "utf8");
      expect(source, `${relativePath} still references DealsConfigSchema`).not.toContain(
        "DealsConfigSchema"
      );
      expect(source, `${relativePath} still exposes deals config`).not.toMatch(
        /\bdeals(?:\.|\s*:)/i
      );
      expect(source, `${relativePath} still advertises /strategy`).not.toContain("/strategy");
      expect(source, `${relativePath} still names removed Telegram tools`).not.toMatch(
        /telegram_(?:send_gift|transfer_collectible)/
      );
    }
  });

  it("keeps generated SDK documentation free of removed deals surfaces", () => {
    expect(existsSync(join(ROOT, "docs-sdk/pages/tools-deals.html"))).toBe(false);

    for (const path of docsSdkFiles()) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} still links the removed deals page`).not.toContain(
        "tools-deals.html"
      );
      expect(source, `${path} still advertises /strategy`).not.toContain("/strategy");
      expect(source, `${path} still exposes deals config`).not.toMatch(/\bdeals(?:\.|\s*:)/i);
    }
  });

  it("preserves strategy workspace instructions independently of the removed module", () => {
    const strategyPath = join(ROOT, "src/templates/STRATEGY.md");
    expect(existsSync(strategyPath)).toBe(true);
    expect(readFileSync(strategyPath, "utf8")).toContain("# STRATEGY.md");
  });

  it("keeps setup animations on the eval-free light Lottie player", () => {
    const webPackage = JSON.parse(readFileSync(join(ROOT, "web/package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(webPackage.dependencies["lottie-react"]).toBeUndefined();
    expect(webPackage.dependencies["lottie-web"]).toBeDefined();

    const player = readFileSync(join(ROOT, "web/src/components/setup/LottiePlayer.tsx"), "utf8");
    expect(player).toContain("lottie-web/build/player/lottie_light");
    expect(player).not.toMatch(/from ['"]lottie-web['"]/);

    for (const file of ["complete.json", "login-telegram.json", "run.json"]) {
      const animation = JSON.parse(
        readFileSync(join(ROOT, "web/src/assets", file), "utf8")
      ) as unknown;
      expect(
        usesUnsupportedLightLottieFeature(animation),
        `${file} requires a feature excluded from the light player`
      ).toBe(false);
    }
  });
});
