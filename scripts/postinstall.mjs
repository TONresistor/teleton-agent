#!/usr/bin/env node
// Postinstall: patch GramJS TL schema + skip problematic dep scripts
import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = dirname(__dirname);
const patchScript = join(root, "scripts", "patch-gramjs.sh");

try {
  execSync(`bash "${patchScript}"`, { stdio: "inherit", cwd: root });
} catch {
  // Non-fatal: styled buttons won't work but everything else will
  console.log("⚠️  GramJS patch skipped (styled buttons disabled)");
}
