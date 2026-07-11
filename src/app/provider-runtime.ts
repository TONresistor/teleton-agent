import { existsSync } from "fs";
import type { Config } from "../config/index.js";
import type { GocoonSupervisor, GocoonSseProxy } from "../gocoon/index.js";
import { getErrorMessage } from "../utils/errors.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("App");

/** Owns provider-specific model registration and supervised provider processes. */
export class ProviderRuntime {
  private gocoonSupervisor: GocoonSupervisor | null = null;
  private gocoonProxy: GocoonSseProxy | null = null;

  constructor(private config: Config) {}

  updateConfig(config: Config): void {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.config.agent.provider === "gocoon") {
      await this.initializeGocoon();
    }
    if (this.config.agent.provider === "local") {
      await this.initializeLocal();
    }
  }

  /** Stop the supervised Gocoon resources without stopping the agent. */
  stopGocoon(): boolean {
    let stopped = false;
    if (this.gocoonProxy) {
      try {
        this.gocoonProxy.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon sse-proxy stop failed");
      }
      this.gocoonProxy = null;
      stopped = true;
    }
    if (this.gocoonSupervisor) {
      try {
        this.gocoonSupervisor.stop();
      } catch (error: unknown) {
        log.error({ err: error }, "gocoon supervisor stop failed");
      }
      this.gocoonSupervisor = null;
      stopped = true;
    }
    return stopped;
  }

  private async initializeGocoon(): Promise<void> {
    const port = this.config.gocoon?.port ?? 10000;
    const autoStart = this.config.gocoon?.auto_start ?? true;
    try {
      if (autoStart) {
        const {
          ensureGocoonBinaries,
          GocoonSupervisor,
          runnerBaseUrl,
          clientConfigPath,
          walletInfo,
        } = await import("../gocoon/index.js");
        if (!existsSync(clientConfigPath())) {
          throw new Error(
            "gocoon is not set up yet; run `teleton gocoon init` (or use the Gocoon page) first"
          );
        }
        await ensureGocoonBinaries();
        const wallet = await walletInfo();
        if (wallet.balanceNano < 2_000_000_000n) {
          throw new Error(
            `COCOON wallet has ${wallet.balanceTon} TON; gocoon needs at least 2 TON free to open the channel. ` +
              `Fund ${wallet.fundAddress} (Gocoon page or \`teleton gocoon init\`), then restart.`
          );
        }
        this.gocoonSupervisor = new GocoonSupervisor({
          configPath: clientConfigPath(),
          healthUrl: `${runnerBaseUrl(port)}/v1/models`,
          startGraceMs: 60_000,
        });
        await this.gocoonSupervisor.start();
        log.info(`Gocoon runner started on port ${port}`);
      }

      const { GocoonSseProxy } = await import("../gocoon/index.js");
      this.gocoonProxy = new GocoonSseProxy({ runnerPort: port });
      await this.gocoonProxy.start();
      const { registerGocoonModels } = await import("../agent/client.js");
      const models = await registerGocoonModels(this.gocoonProxy.port);
      if (models.length === 0) throw new Error(`No models found on port ${port}`);
      log.info(
        `Gocoon ready: ${models.length} model(s) (runner ${port}, sse-proxy ${this.gocoonProxy.port})`
      );
    } catch (error: unknown) {
      log.warn(`Gocoon not ready: ${getErrorMessage(error)}`);
      log.warn(
        "Agent is up but can't chat until gocoon is funded. Open the Gocoon page (or run `teleton gocoon init`), then restart."
      );
    }
  }

  private async initializeLocal(): Promise<void> {
    const baseUrl = this.config.agent.base_url;
    if (!baseUrl) {
      throw new Error(
        "Local provider requires base_url in config (e.g. http://localhost:11434/v1)"
      );
    }

    try {
      const { registerLocalModels } = await import("../agent/client.js");
      const models = await registerLocalModels(baseUrl);
      if (models.length === 0) {
        log.warn("No models found on local LLM server — is it running?");
        return;
      }
      log.info(`Discovered ${models.length} local model(s): ${models.join(", ")}`);
      if (!this.config.agent.model || this.config.agent.model === "auto") {
        this.config.agent.model = models[0];
        log.info(`Using local model: ${models[0]}`);
      }
    } catch (error: unknown) {
      log.error(`Local LLM server unavailable at ${baseUrl}: ${getErrorMessage(error)}`);
      log.error("Start the LLM server first (e.g. ollama serve)");
      throw new Error(`Local LLM server unavailable: ${getErrorMessage(error)}`);
    }
  }
}
