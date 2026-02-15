// src/workspace/__tests__/validator.test.ts

import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { vi } from "vitest";
import {
  validatePath,
  validateReadPath,
  validateWritePath,
  validateDirectory,
  isWithinWorkspace,
  sanitizeFilename,
  validateFileSize,
  listWorkspaceDirectory,
  WorkspaceSecurityError,
} from "../validator.js";

// Mock the paths module before importing
vi.mock("../paths.js", async () => {
  const tempWorkspace = mkdtempSync(join(tmpdir(), "teleton-test-workspace-"));
  return {
    WORKSPACE_ROOT: tempWorkspace,
    TELETON_ROOT: join(tempWorkspace, ".."),
    WORKSPACE_PATHS: {},
    ALLOWED_EXTENSIONS: {
      images: [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"],
      audio: [".mp3", ".ogg", ".wav", ".m4a", ".opus"],
      video: [".mp4", ".mov", ".avi", ".webm", ".mkv"],
      documents: [".md", ".txt", ".json", ".csv", ".pdf", ".yaml", ".yml"],
      code: [".ts", ".js", ".py", ".sh", ".sql"],
      stickers: [".webp", ".tgs"],
      media: [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".bmp",
        ".mp3",
        ".ogg",
        ".wav",
        ".m4a",
        ".opus",
        ".mp4",
        ".mov",
        ".avi",
        ".webm",
        ".mkv",
      ],
    },
    MAX_FILE_SIZES: {
      image: 10 * 1024 * 1024,
      audio: 50 * 1024 * 1024,
      video: 100 * 1024 * 1024,
      document: 50 * 1024 * 1024,
      total_workspace: 500 * 1024 * 1024,
    },
  };
});

describe("Workspace Path Validator", () => {
  let tempWorkspace: string;

  beforeAll(async () => {
    // Get the mocked workspace path
    const paths = await import("../paths.js");
    tempWorkspace = paths.WORKSPACE_ROOT;

    // Create test directory structure
    mkdirSync(join(tempWorkspace, "subdir"));
    mkdirSync(join(tempWorkspace, "subdir", "nested"));
    mkdirSync(join(tempWorkspace, ".hidden"));

    // Create test files
    writeFileSync(join(tempWorkspace, "test.txt"), "test content");
    writeFileSync(join(tempWorkspace, "test.json"), '{"test": true}');
    writeFileSync(join(tempWorkspace, "SOUL.md"), "# Soul");
    writeFileSync(join(tempWorkspace, "STRATEGY.md"), "# Strategy");
    writeFileSync(join(tempWorkspace, "SECURITY.md"), "# Security");
    writeFileSync(join(tempWorkspace, "normal.md"), "# Normal");
    writeFileSync(join(tempWorkspace, ".env"), "SECRET=value");
    writeFileSync(join(tempWorkspace, "subdir", "nested.txt"), "nested");
    writeFileSync(join(tempWorkspace, "large.bin"), Buffer.alloc(100 * 1024 * 1024)); // 100MB
  });

  afterAll(() => {
    // Clean up temp directory
    rmSync(tempWorkspace, { recursive: true, force: true });
  });

  describe("validatePath()", () => {
    describe("Basic path validation", () => {
      it("should validate a simple relative path", () => {
        const result = validatePath("test.txt");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("test.txt");
        expect(result.extension).toBe(".txt");
        expect(result.isDirectory).toBe(false);
      });

      it("should validate a nested relative path", () => {
        const result = validatePath("subdir/nested.txt");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("nested.txt");
        expect(result.relativePath).toBe(join("subdir", "nested.txt"));
      });

      it("should validate an absolute path within workspace", () => {
        const absolutePath = join(tempWorkspace, "test.txt");
        const result = validatePath(absolutePath);
        expect(result.exists).toBe(true);
        expect(result.absolutePath).toBe(absolutePath);
      });

      it("should validate a directory", () => {
        const result = validatePath("subdir");
        expect(result.exists).toBe(true);
        expect(result.isDirectory).toBe(true);
      });

      it("should allow non-existent paths when allowCreate is true", () => {
        const result = validatePath("new-file.txt", true);
        expect(result.exists).toBe(false);
        expect(result.filename).toBe("new-file.txt");
      });
    });

    describe("Empty path rejection", () => {
      it("should reject empty string", () => {
        expect(() => validatePath("")).toThrow(WorkspaceSecurityError);
        expect(() => validatePath("")).toThrow("Path cannot be empty");
      });

      it("should reject whitespace-only string", () => {
        expect(() => validatePath("   ")).toThrow(WorkspaceSecurityError);
        expect(() => validatePath("   ")).toThrow("Path cannot be empty");
      });

      it("should reject tab-only string", () => {
        expect(() => validatePath("\t\t")).toThrow(WorkspaceSecurityError);
      });
    });

    describe("Path traversal prevention", () => {
      it("should reject simple parent directory traversal", () => {
        expect(() => validatePath("../../../etc/passwd")).toThrow(WorkspaceSecurityError);
        expect(() => validatePath("../../../etc/passwd")).toThrow("outside the workspace");
      });

      it("should reject traversal with valid prefix", () => {
        expect(() => validatePath("subdir/../../outside.txt")).toThrow(WorkspaceSecurityError);
      });

      it("should reject absolute path outside workspace", () => {
        expect(() => validatePath("/etc/passwd")).toThrow(WorkspaceSecurityError);
      });

      it("should reject home directory escape", () => {
        expect(() => validatePath("~/../../etc/passwd")).toThrow(WorkspaceSecurityError);
      });

      it("should allow valid paths with dots in filename", () => {
        const result = validatePath("test.txt", true);
        expect(result.filename).toBe("test.txt");
      });

      it("should allow paths starting with dot (hidden files)", () => {
        const result = validatePath(".env");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe(".env");
      });

      it("should allow paths with hidden directories", () => {
        const result = validatePath(".hidden");
        expect(result.exists).toBe(true);
        expect(result.isDirectory).toBe(true);
      });
    });

    describe("URL-encoded traversal prevention", () => {
      it("should reject URL-encoded dot-dot-slash", () => {
        expect(() => validatePath("%2e%2e%2f%2e%2e%2fetc%2fpasswd")).toThrow(
          WorkspaceSecurityError
        );
      });

      it("should reject double-encoded traversal", () => {
        expect(() => validatePath("%252e%252e%252f%252e%252e%252fetc")).toThrow(
          WorkspaceSecurityError
        );
      });

      it("should reject triple-encoded traversal", () => {
        expect(() => validatePath("%25252e%25252e%25252f")).toThrow(WorkspaceSecurityError);
      });

      it("should reject mixed encoding traversal", () => {
        expect(() => validatePath("..%2f..%2f..%2fetc%2fpasswd")).toThrow(WorkspaceSecurityError);
      });

      it("should decode valid URL-encoded filenames", () => {
        // Create a file with space in name
        writeFileSync(join(tempWorkspace, "test file.txt"), "content");
        const result = validatePath("test%20file.txt");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("test file.txt");
      });
    });

    describe("Symlink detection", () => {
      it("should reject symbolic links", () => {
        const linkPath = join(tempWorkspace, "symlink.txt");
        const targetPath = join(tempWorkspace, "test.txt");

        try {
          symlinkSync(targetPath, linkPath);
          expect(() => validatePath("symlink.txt")).toThrow(WorkspaceSecurityError);
          expect(() => validatePath("symlink.txt")).toThrow("Symbolic links are not allowed");
        } finally {
          rmSync(linkPath, { force: true });
        }
      });
    });

    describe("Non-existent path handling", () => {
      it("should reject non-existent path when allowCreate is false", () => {
        expect(() => validatePath("does-not-exist.txt", false)).toThrow(WorkspaceSecurityError);
        expect(() => validatePath("does-not-exist.txt", false)).toThrow("does not exist");
      });

      it("should allow non-existent path when allowCreate is true", () => {
        const result = validatePath("does-not-exist.txt", true);
        expect(result.exists).toBe(false);
      });
    });

    describe("Whitespace and backslash normalization", () => {
      it("should trim leading whitespace", () => {
        const result = validatePath("  test.txt");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("test.txt");
      });

      it("should trim trailing whitespace", () => {
        const result = validatePath("test.txt  ");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("test.txt");
      });

      it("should normalize backslashes to forward slashes", () => {
        const result = validatePath("subdir\\nested.txt");
        expect(result.exists).toBe(true);
        expect(result.filename).toBe("nested.txt");
      });
    });
  });

  describe("validateReadPath()", () => {
    it("should validate existing file for reading", () => {
      const result = validateReadPath("test.txt");
      expect(result.exists).toBe(true);
      expect(result.filename).toBe("test.txt");
    });

    it("should reject directory as read path", () => {
      expect(() => validateReadPath("subdir")).toThrow(WorkspaceSecurityError);
      expect(() => validateReadPath("subdir")).toThrow("Cannot read directory as file");
    });

    it("should reject non-existent file", () => {
      expect(() => validateReadPath("missing.txt")).toThrow(WorkspaceSecurityError);
    });

    it("should reject path traversal in read", () => {
      expect(() => validateReadPath("../../../etc/passwd")).toThrow(WorkspaceSecurityError);
    });

    it("should allow reading hidden files", () => {
      const result = validateReadPath(".env");
      expect(result.exists).toBe(true);
      expect(result.filename).toBe(".env");
    });
  });

  describe("validateWritePath()", () => {
    describe("Immutable file protection", () => {
      it("should block writing to SOUL.md", () => {
        expect(() => validateWritePath("SOUL.md")).toThrow(WorkspaceSecurityError);
        expect(() => validateWritePath("SOUL.md")).toThrow("Cannot write to SOUL.md");
      });

      it("should block writing to STRATEGY.md", () => {
        expect(() => validateWritePath("STRATEGY.md")).toThrow(WorkspaceSecurityError);
        expect(() => validateWritePath("STRATEGY.md")).toThrow("Cannot write to STRATEGY.md");
      });

      it("should block writing to SECURITY.md", () => {
        expect(() => validateWritePath("SECURITY.md")).toThrow(WorkspaceSecurityError);
        expect(() => validateWritePath("SECURITY.md")).toThrow("Cannot write to SECURITY.md");
      });

      it("should allow writing to other .md files", () => {
        const result = validateWritePath("normal.md");
        expect(result.filename).toBe("normal.md");
      });

      it("should block immutable files even in subdirectories", () => {
        writeFileSync(join(tempWorkspace, "subdir", "SOUL.md"), "nested soul");
        expect(() => validateWritePath("subdir/SOUL.md")).toThrow(WorkspaceSecurityError);
      });
    });

    describe("Extension validation", () => {
      it("should allow valid document extension when type specified", () => {
        const result = validateWritePath("new-doc.md", "documents");
        expect(result.extension).toBe(".md");
      });

      it("should reject invalid extension when type specified", () => {
        expect(() => validateWritePath("new-doc.exe", "documents")).toThrow(WorkspaceSecurityError);
        expect(() => validateWritePath("new-doc.exe", "documents")).toThrow("Invalid file type");
      });

      it("should allow any extension when type not specified", () => {
        const result = validateWritePath("new-file.anything", undefined);
        expect(result.extension).toBe(".anything");
      });

      it("should validate image extensions", () => {
        const result = validateWritePath("image.png", "images");
        expect(result.extension).toBe(".png");
      });

      it("should validate code extensions", () => {
        const result = validateWritePath("script.ts", "code");
        expect(result.extension).toBe(".ts");
      });
    });

    describe("Write path security", () => {
      it("should allow creating new files", () => {
        const result = validateWritePath("new-file.txt");
        expect(result.exists).toBe(false);
      });

      it("should reject path traversal in write", () => {
        expect(() => validateWritePath("../../../etc/passwd")).toThrow(WorkspaceSecurityError);
      });

      it("should allow overwriting existing non-immutable files", () => {
        const result = validateWritePath("test.txt");
        expect(result.exists).toBe(true);
      });
    });
  });

  describe("validateDirectory()", () => {
    it("should validate existing directory", () => {
      const result = validateDirectory("subdir");
      expect(result.exists).toBe(true);
      expect(result.isDirectory).toBe(true);
    });

    it("should allow creating new directory", () => {
      const result = validateDirectory("new-dir");
      expect(result.exists).toBe(false);
    });

    it("should reject file as directory", () => {
      expect(() => validateDirectory("test.txt")).toThrow(WorkspaceSecurityError);
      expect(() => validateDirectory("test.txt")).toThrow("is not a directory");
    });

    it("should reject path traversal in directory", () => {
      expect(() => validateDirectory("../../../etc")).toThrow(WorkspaceSecurityError);
    });
  });

  describe("isWithinWorkspace()", () => {
    it("should return true for valid workspace path", () => {
      expect(isWithinWorkspace("test.txt")).toBe(true);
    });

    it("should return false for path outside workspace", () => {
      expect(isWithinWorkspace("../../../etc/passwd")).toBe(false);
    });

    it("should return true for non-existent path in workspace", () => {
      expect(isWithinWorkspace("new-file.txt")).toBe(true);
    });

    it("should return false for absolute path outside workspace", () => {
      expect(isWithinWorkspace("/etc/passwd")).toBe(false);
    });
  });

  describe("sanitizeFilename()", () => {
    it("should remove path separators", () => {
      expect(sanitizeFilename("path/to/file.txt")).toBe("path_to_file.txt");
      expect(sanitizeFilename("path\\to\\file.txt")).toBe("path_to_file.txt");
    });

    it("should remove dot-dot sequences", () => {
      expect(sanitizeFilename("../file.txt")).toBe("__file.txt");
    });

    it("should remove dangerous characters", () => {
      expect(sanitizeFilename('file<>:"|?*.txt')).toBe("file_______.txt");
    });

    it("should remove null bytes and control characters", () => {
      expect(sanitizeFilename("file\x00name.txt")).toBe("filename.txt");
      expect(sanitizeFilename("file\x1fname.txt")).toBe("filename.txt");
    });

    it("should truncate long filenames", () => {
      const longName = "a".repeat(300) + ".txt";
      const sanitized = sanitizeFilename(longName);
      expect(sanitized.length).toBeLessThanOrEqual(255);
    });

    it("should preserve valid filenames", () => {
      expect(sanitizeFilename("valid-file_name.txt")).toBe("valid-file_name.txt");
    });
  });

  describe("validateFileSize()", () => {
    it("should accept file within size limit", () => {
      expect(() => validateFileSize(join(tempWorkspace, "test.txt"), "document")).not.toThrow();
    });

    it("should reject file exceeding size limit", () => {
      expect(() => validateFileSize(join(tempWorkspace, "large.bin"), "image")).toThrow(
        WorkspaceSecurityError
      );
      expect(() => validateFileSize(join(tempWorkspace, "large.bin"), "image")).toThrow(
        "File too large"
      );
    });

    it("should use correct limit for document type", () => {
      // 50MB limit for documents - our large.bin is 100MB so should fail
      expect(() => validateFileSize(join(tempWorkspace, "large.bin"), "document")).toThrow(
        WorkspaceSecurityError
      );
    });
  });

  describe("listWorkspaceDirectory()", () => {
    it("should list files in root workspace", () => {
      const files = listWorkspaceDirectory("");
      expect(files).toContain("test.txt");
      expect(files).toContain("test.json");
      expect(files).toContain("subdir");
    });

    it("should list files in subdirectory", () => {
      const files = listWorkspaceDirectory("subdir");
      expect(files).toContain("nested.txt");
      expect(files).toContain("nested");
    });

    it("should return empty array for non-existent directory", () => {
      const files = listWorkspaceDirectory("does-not-exist");
      expect(files).toEqual([]);
    });

    it("should reject path traversal", () => {
      expect(() => listWorkspaceDirectory("../../../etc")).toThrow(WorkspaceSecurityError);
    });

    it("should list hidden files and directories", () => {
      const files = listWorkspaceDirectory("");
      expect(files).toContain(".env");
      expect(files).toContain(".hidden");
    });
  });

  describe("WorkspaceSecurityError", () => {
    it("should create error with attempted path", () => {
      const error = new WorkspaceSecurityError("Test error", "/bad/path");
      expect(error.message).toBe("Test error");
      expect(error.attemptedPath).toBe("/bad/path");
      expect(error.name).toBe("WorkspaceSecurityError");
    });

    it("should be instanceof Error", () => {
      const error = new WorkspaceSecurityError("Test", "/path");
      expect(error instanceof Error).toBe(true);
    });
  });

  describe("Edge cases and additional security tests", () => {
    it("should reject null byte in path", () => {
      // Null bytes should be removed during sanitization, but path validation should still work
      const pathWithNull = "test\x00file.txt";
      // This should either reject or sanitize - let's see what happens
      expect(() => validatePath(pathWithNull)).toThrow();
    });

    it("should handle deeply nested paths", () => {
      const deepPath = "subdir/nested";
      const result = validatePath(deepPath);
      expect(result.isDirectory).toBe(true);
    });

    it("should handle file without extension", () => {
      writeFileSync(join(tempWorkspace, "noext"), "content");
      const result = validatePath("noext");
      expect(result.extension).toBe("");
      expect(result.filename).toBe("noext");
    });

    it("should handle multiple dots in filename", () => {
      writeFileSync(join(tempWorkspace, "file.test.backup.txt"), "content");
      const result = validatePath("file.test.backup.txt");
      expect(result.extension).toBe(".txt");
      expect(result.filename).toBe("file.test.backup.txt");
    });

    it("should reject root workspace escape via absolute path", () => {
      const outsidePath = join(tempWorkspace, "..", "outside.txt");
      expect(() => validatePath(outsidePath)).toThrow(WorkspaceSecurityError);
    });
  });
});
