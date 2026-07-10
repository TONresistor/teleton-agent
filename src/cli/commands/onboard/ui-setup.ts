import { DIM } from "../../prompts.js";
import { join } from "path";
import { TELETON_ROOT } from "../../../workspace/paths.js";
import type { OnboardOptions } from "../onboard.js";

/**
 * Web UI setup mode: serve the browser setup wizard, then boot TonnetApp once
 * the user clicks "Start Agent". Keeps the CLI->App lifecycle in one place.
 */
export async function runUiSetup(options: OnboardOptions): Promise<void> {
  const { SetupServer } = await import("../../../webui/setup-server.js");
  const port = parseInt(options.uiPort || "7777") || 7777;
  const url = `http://localhost:${port}/setup`;

  // ASCII banner colors (raw ANSI — chalk has no equivalent blue export)
  const blue = "\x1b[34m";
  const reset = "\x1b[0m";
  console.log(`
${blue}  ┌───────────────────────────────────────────────────────────────────────────────────────┐
  │                                                                                       │
  │       ______________    ________________  _   __   ___   _____________   ________     │
  │      /_  __/ ____/ /   / ____/_  __/ __ \\/ | / /  /   | / ____/ ____/ | / /_  __/     │
  │       / / / __/ / /   / __/   / / / / / /  |/ /  / /| |/ / __/ __/ /  |/ / / /        │
  │      / / / /___/ /___/ /___  / / / /_/ / /|  /  / ___ / /_/ / /___/ /|  / / /         │
  │     /_/ /_____/_____/_____/ /_/  \\____/_/ |_/  /_/  |_\\____/_____/_/ |_/ /_/          │
  │                                                                                       │
  └────────────────────────────────────────────────────────────────── DEV: ZKPROOF.T.ME ──┘${reset}

  ${DIM("Setup wizard running at")} ${url}
  ${DIM("Opening in your default browser...")}
  ${DIM("Press Ctrl+C to cancel.")}
`);

  const server = new SetupServer(port);
  await server.start();

  process.on("SIGINT", () => {
    void server.stop().then(() => process.exit(0));
  });

  // Wait for user to click "Start Agent" in the browser
  await server.waitForLaunch();
  console.log("\n  Launch signal received — stopping setup server");
  await server.stop();

  // Boot TonnetApp on the same port
  console.log("  Starting TonnetApp...\n");
  const { TeletonApp } = await import("../../../index.js");
  const configPath = join(TELETON_ROOT, "config.yaml");
  const app = new TeletonApp(configPath);
  await app.start();

  // Keep process alive (TonnetApp manages its own lifecycle)
}

/**
 * Interactive onboarding wizard
 */
