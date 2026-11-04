export {
  TELETON_ROOT,
  WORKSPACE_ROOT,
  WORKSPACE_PATHS,
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZES,
  TEXT_FILE_EXTENSIONS,
  PROTECTED_WORKSPACE_FILES,
  MEMORY_SCAN_FILES,
} from "./paths.js";

export {
  WorkspaceSecurityError,
  validatePath,
  validateReadPath,
  validateWritePath,
  assertMutablePath,
  assertDeletablePath,
  validateDirectory,
  isWithinWorkspace,
  sanitizeFilename,
  validateFileSize,
  listWorkspaceDirectory,
  type ValidatedPath,
} from "./validator.js";

export {
  ensureWorkspace,
  isNewWorkspace,
  loadTemplate,
  type Workspace,
  type WorkspaceConfig,
} from "./manager.js";
