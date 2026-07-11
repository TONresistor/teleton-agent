import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { getErrorMessage } from "../../utils/errors.js";
import { apiError } from "../http.js";
import {
  ensureGocoonBinaries,
  init,
  isInstalled,
  resetWallet,
  runnerBaseUrl,
  topup,
  walletInfo,
  withdrawAll,
  GOCOON_DEFAULT_PORT,
  GOCOON_VERSION,
  type GocoonProgress,
} from "../../gocoon/index.js";

// gocoon management routes (install/setup/top-up/withdraw), thin shells over the
// same lifecycle the CLI uses. Mounted at /api/gocoon and /v1/gocoon.
export function createGocoonRoutes(deps: WebUIServerDeps) {
  const app = new Hono();
  const port = (): number => deps.agent.getConfig().gocoon?.port ?? GOCOON_DEFAULT_PORT;

  let withdraw: {
    running: boolean;
    done: boolean;
    events: GocoonProgress[];
    error?: string;
  } | null = null;

  app.get("/status", async (c) => {
    const data: Record<string, unknown> = {
      installed: isInstalled(),
      version: isInstalled() ? GOCOON_VERSION : null,
    };
    try {
      const w = await walletInfo();
      data.wallet = {
        fundAddress: w.fundAddress,
        ownerAddress: w.ownerAddress,
        balanceTon: w.balanceTon,
        balanceNano: w.balanceNano.toString(),
        funded: w.funded,
        recommendedFundingTon: w.recommendedFundingTon,
      };
    } catch {
      data.wallet = null;
    }
    data.runner = await fetch(`${runnerBaseUrl(port())}/jsonstats`, {
      signal: AbortSignal.timeout(800),
    })
      .then(() => true)
      .catch(() => false);
    return c.json({ success: true, data } as APIResponse);
  });

  app.post("/install", async (c) => {
    try {
      await ensureGocoonBinaries();
      return c.json({ success: true, data: { version: GOCOON_VERSION } } as APIResponse);
    } catch (err) {
      return apiError(c, err, 500);
    }
  });

  app.post("/init", async (c) => {
    try {
      const s = await init();
      return c.json({
        success: true,
        data: { fundAddress: s.fundAddress, recommendedFundingTon: s.recommendedFundingTon },
      } as APIResponse);
    } catch (err) {
      return apiError(c, err, 500);
    }
  });

  // Poll this until funded flips true after the user sends the TON.
  app.get("/balance", async (c) => {
    try {
      const w = await walletInfo();
      return c.json({
        success: true,
        data: { balanceTon: w.balanceTon, balanceNano: w.balanceNano.toString(), funded: w.funded },
      } as APIResponse);
    } catch (err) {
      return apiError(c, err, 400);
    }
  });

  app.post("/topup", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { amount?: string | number };
      const amount = String(body.amount ?? "").trim();
      if (!amount)
        return c.json({ success: false, error: "amount (TON) is required" } as APIResponse, 400);
      await topup(amount, port());
      return c.json({ success: true, data: { amount } } as APIResponse);
    } catch (err) {
      return apiError(c, err, 400);
    }
  });

  // Async: POST starts a withdraw, GET polls its progress.
  app.post("/withdraw", async (c) => {
    if (withdraw?.running) {
      return c.json(
        { success: false, error: "a withdraw is already in progress" } as APIResponse,
        409
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as { destination?: string };
    const destination = String(body.destination ?? "").trim();
    if (!destination)
      return c.json({ success: false, error: "destination is required" } as APIResponse, 400);

    const job: { running: boolean; done: boolean; events: GocoonProgress[]; error?: string } = {
      running: true,
      done: false,
      events: [],
    };
    withdraw = job;
    void withdrawAll(destination, (e) => job.events.push(e), port())
      .then(() => {
        job.running = false;
        job.done = true;
      })
      .catch((err) => {
        job.running = false;
        job.done = true;
        job.error = getErrorMessage(err);
      });
    return c.json({ success: true, data: { started: true } } as APIResponse);
  });

  app.get("/withdraw", (c) =>
    c.json({
      success: true,
      data: withdraw ?? { running: false, done: false, events: [] },
    } as APIResponse)
  );

  // Stop teleton's supervised runner so a withdraw can proceed (withdrawAll
  // refuses while the runner is active). Waits for the port to go quiet so the
  // caller knows it's safe to start the withdraw.
  app.post("/runner/stop", async (c) => {
    const wasRunning = deps.gocoonControl?.stopRunner() ?? false;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const up = await fetch(`${runnerBaseUrl(port())}/jsonstats`, {
        signal: AbortSignal.timeout(800),
      })
        .then(() => true)
        .catch(() => false);
      if (!up) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    return c.json({ success: true, data: { stopped: wasRunning } } as APIResponse);
  });

  // Wipe the local COCOON wallet + config so the next setup creates a fresh
  // wallet. Guarded in resetWallet: refuses while the runner is up, or while
  // funds / an active channel remain (unless force).
  app.post("/reset", async (c) => {
    try {
      const body = (await c.req.json().catch(() => ({}))) as { force?: boolean };
      await resetWallet({ force: Boolean(body.force) }, port());
      return c.json({ success: true, data: { reset: true } } as APIResponse);
    } catch (err) {
      return apiError(c, err, 400);
    }
  });

  return app;
}
