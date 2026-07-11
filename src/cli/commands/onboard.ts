/**
 * Teleton Onboarding Wizard
 *
 * Interactive setup wizard with @inquirer/prompts UI.
 */

import { createPrompter, CancelledError, DIM } from "../prompts.js";
import type { SupportedProvider } from "../../config/providers.js";
import { runInteractiveOnboarding } from "./onboard/interactive.js";
import { runNonInteractiveOnboarding } from "./onboard/non-interactive.js";
import { runUiSetup } from "./onboard/ui-setup.js";

export interface OnboardOptions {
  workspace?: string;
  nonInteractive?: boolean;
  ui?: boolean;
  uiPort?: string;
  mode?: "user" | "bot";
  apiId?: number;
  apiHash?: string;
  phone?: string;
  botToken?: string;
  apiKey?: string;
  baseUrl?: string;
  userId?: number;
  provider?: SupportedProvider;
  tavilyApiKey?: string;
}

/**
 * Main onboard command
 */
export async function onboardCommand(options: OnboardOptions = {}): Promise<void> {
  // Web UI mode
  if (options.ui) {
    await runUiSetup(options);
    return;
  }

  const prompter = createPrompter();

  try {
    if (options.nonInteractive) {
      await runNonInteractiveOnboarding(options, prompter);
    } else {
      await runInteractiveOnboarding(options, prompter);
    }
  } catch (error) {
    if (error instanceof CancelledError) {
      console.log(`\n  ${DIM("Setup cancelled. No changes were made.")}\n`);
      process.exit(0);
    }
    throw error;
  }
}
