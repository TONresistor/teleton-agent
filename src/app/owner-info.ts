import type { Api } from "telegram";
import type { Config } from "../config/index.js";
import { readRawConfig, setNestedValue, writeRawConfig } from "../config/configurable-keys.js";
import type { ITelegramBridge } from "../telegram/bridge-interface.js";
import { isUserBridge } from "../telegram/bridge-guards.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");

/** Resolve and persist missing owner profile fields from Telegram once. */
export async function resolveOwnerInfo(
  config: Config,
  bridge: ITelegramBridge,
  configPath: string
): Promise<void> {
  try {
    if (config.telegram.owner_name && config.telegram.owner_username) return;
    if (!config.telegram.owner_id || !isUserBridge(bridge)) return;

    const entity = await bridge.getClient().getEntity(String(config.telegram.owner_id));
    if (!entity || !("firstName" in entity)) return;

    const user = entity as Api.User;
    const fullName = user.lastName
      ? `${user.firstName || ""} ${user.lastName}`
      : user.firstName || "";
    const username = user.username || "";
    let updated = false;
    if (!config.telegram.owner_name && fullName) {
      config.telegram.owner_name = fullName;
      updated = true;
    }
    if (!config.telegram.owner_username && username) {
      config.telegram.owner_username = username;
      updated = true;
    }
    if (!updated) return;

    const raw = readRawConfig(configPath);
    if (config.telegram.owner_name) {
      setNestedValue(raw, "telegram.owner_name", config.telegram.owner_name);
    }
    if (config.telegram.owner_username) {
      setNestedValue(raw, "telegram.owner_username", config.telegram.owner_username);
    }
    writeRawConfig(raw, configPath);

    const displayName = config.telegram.owner_name || "Unknown";
    const displayUsername = config.telegram.owner_username
      ? ` (@${config.telegram.owner_username})`
      : "";
    log.info(`Owner resolved: ${displayName}${displayUsername}`);
  } catch (error) {
    log.warn(`Could not resolve owner info: ${getErrorMessage(error)}`);
  }
}
