// src/workspace/manager.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TELETON_ROOT, WORKSPACE_ROOT, WORKSPACE_PATHS } from "./paths.js";

// Resolve package root by walking up from current file until we find package.json
function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, "package.json"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}
const TEMPLATES_DIR = join(findPackageRoot(), "src", "templates");

export interface WorkspaceConfig {
  workspaceDir?: string;
  ensureTemplates?: boolean;
}

export interface Workspace {
  root: string;
  workspace: string;
  // Workspace files (agent CAN access)
  soulPath: string;
  memoryPath: string;
  identityPath: string;
  userPath: string;
  bootstrapPath: string;
  strategyPath: string;
  securityPath: string;
  // Workspace directories
  memoryDir: string;
  downloadsDir: string;
  uploadsDir: string;
  tempDir: string;
  memesDir: string;
  // Protected files (agent CANNOT access)
  sessionPath: string;
  configPath: string;
  walletPath: string;
}

/**
 * Ensure workspace directory structure exists and is initialized
 */
export async function ensureWorkspace(config?: WorkspaceConfig): Promise<Workspace> {
  // Create base teleton directory
  if (!existsSync(TELETON_ROOT)) {
    mkdirSync(TELETON_ROOT, { recursive: true });
    console.log(`✓ Created Teleton root at ${TELETON_ROOT}`);
  }

  // Create workspace directory
  if (!existsSync(WORKSPACE_ROOT)) {
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
    console.log(`✓ Created workspace at ${WORKSPACE_ROOT}`);
  }

  // Create workspace subdirectories
  const directories = [
    WORKSPACE_PATHS.MEMORY_DIR,
    WORKSPACE_PATHS.DOWNLOADS_DIR,
    WORKSPACE_PATHS.UPLOADS_DIR,
    WORKSPACE_PATHS.TEMP_DIR,
    WORKSPACE_PATHS.MEMES_DIR,
  ];

  for (const dir of directories) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Define file paths
  const workspace: Workspace = {
    root: TELETON_ROOT,
    workspace: WORKSPACE_ROOT,
    // Workspace files
    soulPath: WORKSPACE_PATHS.SOUL,
    memoryPath: WORKSPACE_PATHS.MEMORY,
    identityPath: WORKSPACE_PATHS.IDENTITY,
    userPath: WORKSPACE_PATHS.USER,
    bootstrapPath: WORKSPACE_PATHS.BOOTSTRAP,
    strategyPath: WORKSPACE_PATHS.STRATEGY,
    securityPath: WORKSPACE_PATHS.SECURITY,
    // Workspace directories
    memoryDir: WORKSPACE_PATHS.MEMORY_DIR,
    downloadsDir: WORKSPACE_PATHS.DOWNLOADS_DIR,
    uploadsDir: WORKSPACE_PATHS.UPLOADS_DIR,
    tempDir: WORKSPACE_PATHS.TEMP_DIR,
    memesDir: WORKSPACE_PATHS.MEMES_DIR,
    // Protected files (outside workspace)
    sessionPath: join(TELETON_ROOT, "telegram_session.txt"),
    configPath: join(TELETON_ROOT, "config.yaml"),
    walletPath: join(TELETON_ROOT, "wallet.json"),
  };

  // Bootstrap templates if requested
  if (config?.ensureTemplates) {
    await bootstrapTemplates(workspace);
  }

  return workspace;
}

/**
 * Bootstrap workspace with template files
 */
async function bootstrapTemplates(workspace: Workspace): Promise<void> {
  const templates = [
    { name: "SOUL.md", path: workspace.soulPath },
    { name: "MEMORY.md", path: workspace.memoryPath },
    { name: "IDENTITY.md", path: workspace.identityPath },
    { name: "USER.md", path: workspace.userPath },
    { name: "BOOTSTRAP.md", path: workspace.bootstrapPath },
    { name: "SECURITY.md", path: workspace.securityPath },
    { name: "STRATEGY.md", path: workspace.strategyPath },
  ];

  for (const template of templates) {
    if (!existsSync(template.path)) {
      const templateSource = join(TEMPLATES_DIR, template.name);
      if (existsSync(templateSource)) {
        copyFileSync(templateSource, template.path);
        console.log(`  ✓ Created ${template.name}`);
      }
    }
  }
}

/**
 * Check if workspace is brand new (no config file)
 */
export function isNewWorkspace(workspace: Workspace): boolean {
  return !existsSync(workspace.configPath);
}

/**
 * Load template content
 */
export function loadTemplate(name: string): string {
  const templatePath = join(TEMPLATES_DIR, name);
  if (!existsSync(templatePath)) {
    throw new Error(`Template ${name} not found at ${templatePath}`);
  }
  return readFileSync(templatePath, "utf-8");
}

/**
 * Write file only if it doesn't exist
 */
export function writeFileIfMissing(path: string, content: string): void {
  if (!existsSync(path)) {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(path, content, "utf-8");
  }
}

/**
 * Get workspace stats
 */
export function getWorkspaceStats(workspace: Workspace): {
  exists: boolean;
  hasConfig: boolean;
  hasTemplates: boolean;
  hasSession: boolean;
  hasWallet: boolean;
} {
  return {
    exists: existsSync(workspace.workspace),
    hasConfig: existsSync(workspace.configPath),
    hasTemplates:
      existsSync(workspace.soulPath) &&
      existsSync(workspace.memoryPath) &&
      existsSync(workspace.identityPath),
    hasSession: existsSync(workspace.sessionPath),
    hasWallet: existsSync(workspace.walletPath),
  };
}
