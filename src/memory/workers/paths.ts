import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function findPackageRoot(): string {
  let current = dirname(fileURLToPath(import.meta.url));
  const root = parse(current).root;

  while (current !== root) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string };
        if (pkg.name === "teleton") return current;
      } catch {
        // Keep walking: bundled chunks can live below unrelated package files.
      }
    }
    current = dirname(current);
  }

  throw new Error("Unable to locate the Teleton package root for worker startup");
}

export interface MemoryWorkerLaunch {
  url: URL;
  argv?: string[];
  execArgv?: string[];
}

export function resolveMemoryWorkerLaunch(
  name: "embedding-worker" | "vector-search-worker"
): MemoryWorkerLaunch {
  const currentFile = fileURLToPath(import.meta.url);
  const sourceRuntime = currentFile.includes(`${sep}src${sep}`);
  const packageRoot = findPackageRoot();
  const targetPath = sourceRuntime
    ? join(packageRoot, "src", "memory", "workers", `${name}.ts`)
    : join(packageRoot, "dist", "memory", "workers", `${name}.js`);

  if (!existsSync(targetPath)) {
    throw new Error(`Memory worker entry not found: ${targetPath}`);
  }
  if (!sourceRuntime) return { url: pathToFileURL(targetPath) };

  const bootstrapPath = join(packageRoot, "src", "memory", "workers", "source-bootstrap.mjs");
  if (!existsSync(bootstrapPath)) {
    throw new Error(`Memory worker bootstrap not found: ${bootstrapPath}`);
  }
  return {
    url: pathToFileURL(bootstrapPath),
    argv: [pathToFileURL(targetPath).href],
    execArgv: [],
  };
}
