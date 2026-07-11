import type { createPrompter } from "../../prompts.js";
import { ensureWorkspace } from "../../../workspace/manager.js";
import { writeFileSync } from "fs";
import YAML from "yaml";
import { getProviderMetadata, providerNeedsApiKey } from "../../../config/providers.js";
import { assertGrokBuildReady } from "../../../providers/grok-build-credentials.js";
import { getErrorMessage } from "../../../utils/errors.js";
import type { OnboardOptions } from "../onboard.js";
import { buildConfig } from "./config-builder.js";
import { BOT_TOKEN_REGEX } from "./telegram-validation.js";

/**
 * Non-interactive onboarding (requires all options)
 */
export async function runNonInteractiveOnboarding(
  options: OnboardOptions,
  prompter: ReturnType<typeof createPrompter>
): Promise<void> {
  const selectedProvider = options.provider || "anthropic";
  const nonInteractiveMode = options.mode || "user";
  const needsApiKey = providerNeedsApiKey(selectedProvider);
  if (nonInteractiveMode === "bot") {
    if (!options.botToken) {
      prompter.error("Non-interactive bot mode requires: --bot-token");
      process.exit(1);
    }
    if (!BOT_TOKEN_REGEX.test(options.botToken)) {
      prompter.error("--bot-token format invalid (expected 123456:ABC...)");
      process.exit(1);
    }
    if (!options.userId) {
      prompter.error("Non-interactive bot mode requires: --user-id");
      process.exit(1);
    }
  } else {
    if (!options.apiId || !options.apiHash || !options.phone || !options.userId) {
      prompter.error("Non-interactive mode requires: --api-id, --api-hash, --phone, --user-id");
      process.exit(1);
    }
  }
  if (needsApiKey && !options.apiKey) {
    prompter.error(`Non-interactive mode requires --api-key for provider "${selectedProvider}"`);
    process.exit(1);
  }
  if (selectedProvider === "local" && !options.baseUrl) {
    prompter.error("Non-interactive mode requires --base-url for local provider");
    process.exit(1);
  }
  if (selectedProvider === "grok-build") {
    try {
      assertGrokBuildReady();
    } catch (error: unknown) {
      prompter.error(getErrorMessage(error));
      process.exit(1);
    }
  }

  const workspace = await ensureWorkspace({
    workspaceDir: options.workspace,
    ensureTemplates: true,
  });

  const providerMeta = getProviderMetadata(selectedProvider);

  const config = buildConfig({
    provider: selectedProvider,
    apiKey: options.apiKey || "",
    baseUrl: options.baseUrl,
    model: providerMeta.defaultModel,
    maxAgenticIterations: 5,
    telegramMode: nonInteractiveMode,
    apiId: options.apiId ?? 0,
    apiHash: options.apiHash ?? "",
    phone: options.phone ?? "",
    userId: options.userId ?? 0,
    dmPolicy: "admin-only",
    groupPolicy: "admin-only",
    requireMention: true,
    execMode: "off",
    botToken: nonInteractiveMode === "bot" ? options.botToken : undefined,
    botUsername: undefined,
    tavilyApiKey: options.tavilyApiKey,
    sessionPath: workspace.sessionPath,
    workspaceRoot: workspace.root,
  });

  const configYaml = YAML.stringify(config);
  writeFileSync(workspace.configPath, configYaml, { encoding: "utf-8", mode: 0o600 });

  prompter.success(`Configuration created: ${workspace.configPath}`);
}
