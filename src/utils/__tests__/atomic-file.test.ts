import { afterEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  renameSync: vi.fn((await original<typeof import("node:fs")>()).renameSync),
}));
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePrivateFileAtomic } from "../atomic-file.js";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
it("preserves old data on failed rename, cleans temporary files, and follows symlinks", () => {
  const dir = fs.mkdtempSync(join(tmpdir(), "teleton-atomic-"));
  dirs.push(dir);
  const path = join(dir, "config");
  const link = join(dir, "link");
  fs.writeFileSync(path, "old");
  const originalMode = fs.statSync(path).mode & 0o777;
  fs.symlinkSync(path, link);
  const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw new Error("disk error");
  });
  expect(() => writePrivateFileAtomic(link, "new")).toThrow("disk error");
  expect(fs.readFileSync(path, "utf8")).toBe("old");
  expect(fs.readdirSync(dir).sort()).toEqual(["config", "link"]);
  rename.mockRestore();
  writePrivateFileAtomic(link, "new");
  expect(fs.readFileSync(path, "utf8")).toBe("new");
  expect(fs.statSync(path).mode & 0o777).toBe(originalMode);
  expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  writePrivateFileAtomic(join(dir, "fresh"), "new");
  expect(fs.statSync(join(dir, "fresh")).mode & 0o777).toBe(0o600);
});
