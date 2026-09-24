import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebUIServerDeps } from "../types.js";

const mocks = vi.hoisted(() => ({
  info: vi.fn(),
  openBrowser: vi.fn(),
  startHonoServer: vi.fn(),
}));

vi.mock("../../utils/logger.js", () => ({
  createLogger: () => ({ info: mocks.info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../../utils/open-browser.js", () => ({ openBrowser: mocks.openBrowser }));
vi.mock("../../utils/http-server.js", () => ({
  startHonoServer: mocks.startHonoServer,
  stopHonoServer: vi.fn(),
}));
vi.mock("../static-serving.js", () => ({ findWebDist: () => null }));

import { WebUIServer } from "../server.js";

function createServer(): WebUIServer {
  return new WebUIServer({
    config: {
      auth_token: "test-token",
      host: "127.0.0.1",
      port: 7777,
      cors_origins: [],
      log_requests: false,
    },
  } as unknown as WebUIServerDeps);
}

describe("WebUI authenticated launch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.startHonoServer.mockImplementation(async ({ onListen }) => {
      onListen({ address: "127.0.0.1", port: 7777 });
      return {};
    });
  });

  it("prints the complete sign-in link without opening a browser by default", async () => {
    await createServer().start();

    expect(mocks.info).toHaveBeenCalledWith(
      "URL: http://127.0.0.1:7777/auth/exchange?token=test-token"
    );
    expect(mocks.openBrowser).not.toHaveBeenCalled();
  });

  it("opens that same link when the explicit WebUI flag is passed through", async () => {
    await createServer().start({ openBrowser: true });

    expect(mocks.openBrowser).toHaveBeenCalledOnce();
    expect(mocks.openBrowser).toHaveBeenCalledWith(
      "http://127.0.0.1:7777/auth/exchange?token=test-token",
      expect.any(Function)
    );
  });
});
