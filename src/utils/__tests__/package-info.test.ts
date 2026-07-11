import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PACKAGE_INFO, PACKAGE_VERSION, findPackageRoot } from "../package-info.js";

describe("package info", () => {
  it("resolves the repository package version from one canonical source", () => {
    const root = findPackageRoot();
    expect(root).not.toBeNull();
    const pkg = JSON.parse(readFileSync(join(root!, "package.json"), "utf8")) as {
      version: string;
    };

    expect(PACKAGE_INFO.root).toBe(root);
    expect(PACKAGE_VERSION).toBe(pkg.version);
  });

  it("fails closed when no package manifest can be found", () => {
    expect(findPackageRoot("file:///definitely/missing/teleton/file.js")).toBeNull();
  });
});
