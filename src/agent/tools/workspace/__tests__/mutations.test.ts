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
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../workspace/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../workspace/paths.js")>();
  return {
    ...original,
    WORKSPACE_ROOT: mkdtempSync(join(tmpdir(), "teleton-mutations-")),
  };
});

import { PROTECTED_WORKSPACE_FILES, WORKSPACE_ROOT } from "../../../../workspace/paths.js";
import { validateWritePath } from "../../../../workspace/validator.js";
import { workspaceDeleteExecutor } from "../delete.js";
import { workspaceRenameExecutor } from "../rename.js";

const context = {} as never;
const policyFiles = ["SOUL.md", "STRATEGY.md", "SECURITY.md"];

beforeEach(() => {
  rmSync(WORKSPACE_ROOT, { recursive: true, force: true });
  mkdirSync(WORKSPACE_ROOT);
  for (const filename of PROTECTED_WORKSPACE_FILES) {
    writeFileSync(join(WORKSPACE_ROOT, filename), `original ${filename}`);
  }
  writeFileSync(join(WORKSPACE_ROOT, "replacement.txt"), "replacement");
});

afterAll(() => rmSync(WORKSPACE_ROOT, { recursive: true, force: true }));

describe("workspace policy-file mutations", () => {
  it.each(policyFiles)("rejects renaming %s away without changing files", async (filename) => {
    await expect(
      workspaceRenameExecutor({ from: filename, to: "moved.txt" }, context)
    ).rejects.toThrow("Cannot rename");
    expect(readFileSync(join(WORKSPACE_ROOT, filename), "utf8")).toBe(`original ${filename}`);
    expect(existsSync(join(WORKSPACE_ROOT, "moved.txt"))).toBe(false);
  });

  it.each(policyFiles)("rejects replacing %s without changing either file", async (filename) => {
    await expect(
      workspaceRenameExecutor({ from: "replacement.txt", to: filename, overwrite: true }, context)
    ).rejects.toThrow("Cannot rename");
    expect(readFileSync(join(WORKSPACE_ROOT, filename), "utf8")).toBe(`original ${filename}`);
    expect(readFileSync(join(WORKSPACE_ROOT, "replacement.txt"), "utf8")).toBe("replacement");
  });

  it.each(["./SECURITY.md", "folder/../SECURITY.md", "%2553ECURITY.md", "security.md"])(
    "rejects normalized or case aliases: %s",
    async (filename) => {
      expect(() => validateWritePath(filename)).toThrow("Cannot write");
      await expect(
        workspaceRenameExecutor({ from: "replacement.txt", to: filename, overwrite: true }, context)
      ).rejects.toThrow("Cannot rename");
      expect(readFileSync(join(WORKSPACE_ROOT, "SECURITY.md"), "utf8")).toBe(
        "original SECURITY.md"
      );
    }
  );

  it("rejects creating an immutable destination before creating its parents", async () => {
    await expect(
      workspaceRenameExecutor({ from: "replacement.txt", to: "new/SOUL.md" }, context)
    ).rejects.toThrow("Cannot rename");
    expect(existsSync(join(WORKSPACE_ROOT, "new"))).toBe(false);
    expect(existsSync(join(WORKSPACE_ROOT, "replacement.txt"))).toBe(true);
  });

  it("preserves ordinary move, parent creation and overwrite behavior", async () => {
    expect(
      await workspaceRenameExecutor({ from: "replacement.txt", to: "new/file.txt" }, context)
    ).toMatchObject({ success: true });
    writeFileSync(join(WORKSPACE_ROOT, "second.txt"), "second");
    expect(
      await workspaceRenameExecutor({ from: "second.txt", to: "new/file.txt" }, context)
    ).toMatchObject({ success: false });
    expect(
      await workspaceRenameExecutor(
        { from: "second.txt", to: "new/file.txt", overwrite: true },
        context
      )
    ).toMatchObject({ success: true });
    expect(readFileSync(join(WORKSPACE_ROOT, "new/file.txt"), "utf8")).toBe("second");
  });

  it.each(PROTECTED_WORKSPACE_FILES)(
    "preserves direct delete protection for %s",
    async (filename) => {
      expect(await workspaceDeleteExecutor({ path: filename }, context)).toMatchObject({
        success: false,
      });
      expect(readFileSync(join(WORKSPACE_ROOT, filename), "utf8")).toBe(`original ${filename}`);
    }
  );

  it.each([".", "folder/..", "%2e", WORKSPACE_ROOT])(
    "rejects deleting the workspace root via %s",
    async (path) => {
      expect(await workspaceDeleteExecutor({ path, recursive: true }, context)).toMatchObject({
        success: false,
      });
      expect(readFileSync(join(WORKSPACE_ROOT, "SECURITY.md"), "utf8")).toBe(
        "original SECURITY.md"
      );
      expect(existsSync(join(WORKSPACE_ROOT, "replacement.txt"))).toBe(true);
    }
  );

  it.each(["SECURITY.md", "soul.md", "MEMORY.md"])(
    "rejects recursive deletion of a tree containing %s before removing ordinary files",
    async (filename) => {
      mkdirSync(join(WORKSPACE_ROOT, "nested/deep"), { recursive: true });
      writeFileSync(join(WORKSPACE_ROOT, "nested/ordinary.txt"), "keep");
      writeFileSync(join(WORKSPACE_ROOT, "nested/deep", filename), "protected");
      expect(
        await workspaceDeleteExecutor({ path: "nested", recursive: true }, context)
      ).toMatchObject({ success: false });
      expect(readFileSync(join(WORKSPACE_ROOT, "nested/ordinary.txt"), "utf8")).toBe("keep");
      expect(readFileSync(join(WORKSPACE_ROOT, "nested/deep", filename), "utf8")).toBe("protected");
    }
  );

  it("deletes ordinary files and directories without following descendant symlinks", async () => {
    const outside = mkdtempSync(join(tmpdir(), "teleton-mutations-outside-"));
    try {
      writeFileSync(join(outside, "SECURITY.md"), "outside");
      mkdirSync(join(WORKSPACE_ROOT, "ordinary/deep"), { recursive: true });
      writeFileSync(join(WORKSPACE_ROOT, "ordinary/deep/file.txt"), "remove");
      symlinkSync(outside, join(WORKSPACE_ROOT, "ordinary/link"));
      expect(
        await workspaceDeleteExecutor({ path: "ordinary", recursive: true }, context)
      ).toMatchObject({ success: true });
      expect(existsSync(join(WORKSPACE_ROOT, "ordinary"))).toBe(false);
      expect(readFileSync(join(outside, "SECURITY.md"), "utf8")).toBe("outside");
      expect(await workspaceDeleteExecutor({ path: "replacement.txt" }, context)).toMatchObject({
        success: true,
      });
      mkdirSync(join(WORKSPACE_ROOT, "empty"));
      expect(await workspaceDeleteExecutor({ path: "empty" }, context)).toMatchObject({
        success: true,
      });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
