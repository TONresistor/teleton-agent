// src/workspace/index.ts

// Path constants
export {
  TELETON_ROOT,
  WORKSPACE_ROOT,
  WORKSPACE_PATHS,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZES,
} from "./paths.js";

// Validation functions
export {
  WorkspaceSecurityError,
  validatePath,
  validateReadPath,
  validateWritePath,
  validateDirectory,
  isWithinWorkspace,
  sanitizeFilename,
  validateFileSize,
  listWorkspaceDirectory,
  type ValidatedPath,
} from "./validator.js";

// Re-export manager functions
export {
  ensureWorkspace,
  isNewWorkspace,
  loadTemplate,
  writeFileIfMissing,
  getWorkspaceStats,
  type Workspace,
  type WorkspaceConfig,
} from "./manager.js";
