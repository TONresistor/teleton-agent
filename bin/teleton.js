#!/usr/bin/env node
import { execFileSync } from "node:child_process";

if (process.platform === "win32" && process.stdout.isTTY) {
  try {
    // chcp changes the attached console, so UTF-8 log output is not decoded as CP866/1251.
    execFileSync("chcp.com", ["65001"], { stdio: "ignore" });
  } catch {
    // Logging still works on terminals where the console code page cannot be changed.
  }
}

await import("../dist/cli/index.js");
