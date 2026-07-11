import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_SEARCH_DEPTH = 10;

export interface PackageInfo {
  root: string | null;
  version: string;
}

export function findPackageRoot(startUrl: string = import.meta.url): string | null {
  let directory = dirname(fileURLToPath(startUrl));
  for (let depth = 0; depth < PACKAGE_SEARCH_DEPTH; depth += 1) {
    if (existsSync(join(directory, "package.json"))) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}

export function readPackageInfo(startUrl: string = import.meta.url): PackageInfo {
  const root = findPackageRoot(startUrl);
  if (!root) return { root: null, version: "0.0.0" };

  try {
    const parsed = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return {
      root,
      version: typeof parsed.version === "string" ? parsed.version : "0.0.0",
    };
  } catch {
    return { root, version: "0.0.0" };
  }
}

export const PACKAGE_INFO = readPackageInfo();
export const PACKAGE_VERSION = PACKAGE_INFO.version;
