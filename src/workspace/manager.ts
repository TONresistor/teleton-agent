// src/workspace/manager.ts

import { existsSync, mkdirSync, readFileSync, copyFileSync } from "fs";
import { join } from "path";
import { TELETON_ROOT, WORKSPACE_ROOT, WORKSPACE_PATHS } from "./paths.js";
import { createLogger } from "../utils/logger.js";
import { findPackageRoot } from "../utils/package-info.js";

const log = createLogger("Workspace");

const TEMPLATES_DIR = join(findPackageRoot() ?? process.cwd(), "src", "templates");

export interface WorkspaceConfig {
  workspaceDir?: string;
  ensureTemplates?: boolean;
  /** Suppress log.info() output (useful when CLI spinners are active) */
  silent?: boolean;
}

export interface Workspace {
  root: string;
  workspace: string;
  // Workspace files (agent CAN access)
  soulPath: string;
  memoryPath: string;
  identityPath: string;
  userPath: string;
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
  const silent = config?.silent ?? false;

  // Create base teleton directory
  if (!existsSync(TELETON_ROOT)) {
    mkdirSync(TELETON_ROOT, { recursive: true });
    if (!silent) log.info(`Created Teleton root at ${TELETON_ROOT}`);
  }

  // Create workspace directory
  if (!existsSync(WORKSPACE_ROOT)) {
    mkdirSync(WORKSPACE_ROOT, { recursive: true });
    if (!silent) log.info(`Created workspace at ${WORKSPACE_ROOT}`);
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
    await bootstrapTemplates(workspace, silent);
  }

  return workspace;
}

/**
 * Bootstrap workspace with template files
 */
async function bootstrapTemplates(workspace: Workspace, silent = false): Promise<void> {
  const templates = [
    { name: "SOUL.md", path: workspace.soulPath },
    { name: "MEMORY.md", path: workspace.memoryPath },
    { name: "IDENTITY.md", path: workspace.identityPath },
    { name: "USER.md", path: workspace.userPath },
    { name: "SECURITY.md", path: workspace.securityPath },
    { name: "STRATEGY.md", path: workspace.strategyPath },
    { name: "HEARTBEAT.md", path: WORKSPACE_PATHS.HEARTBEAT },
  ];

  for (const template of templates) {
    if (!existsSync(template.path)) {
      const templateSource = join(TEMPLATES_DIR, template.name);
      if (existsSync(templateSource)) {
        copyFileSync(templateSource, template.path);
        if (!silent) log.info(`Created ${template.name}`);
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
