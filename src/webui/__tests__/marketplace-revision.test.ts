import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RegistryEntry } from "../types.js";

const state = vi.hoisted(() => ({
  directory: `/tmp/teleton-marketplace-regression-${process.pid}`,
}));
vi.mock("../../workspace/paths.js", async (original) => ({
  ...(await original<typeof import("../../workspace/paths.js")>()),
  TELETON_ROOT: state.directory,
  WORKSPACE_PATHS: { PLUGINS_DIR: state.directory },
}));
import { MarketplaceService } from "../services/marketplace.js";

const revision = "a".repeat(40);
afterEach(() => vi.unstubAllGlobals());
afterAll(() => rmSync(state.directory, { recursive: true, force: true }));

function service() {
  return new MarketplaceService({} as never);
}

describe("marketplace immutable revision", () => {
  it("pins registry and manifest requests to the resolved commit", async () => {
    const fetch = vi.fn(async (input: string) => {
      if (input.endsWith("/commits/main")) return Response.json({ sha: revision });
      if (input.endsWith(`/${revision}/registry.json`))
        return Response.json({
          plugins: [
            {
              id: "example",
              name: "Example",
              path: "plugins/example",
              description: "",
              author: "",
              tags: [],
            },
          ],
        });
      if (input.endsWith(`/${revision}/plugins/example/manifest.json`))
        return Response.json({ name: "Example", version: "1.0.0" });
      throw new Error(`Unexpected mutable request: ${input}`);
    });
    vi.stubGlobal("fetch", fetch);
    const marketplace = service();
    const registry = await marketplace.getRegistry();
    expect(registry[0].sourceRef).toBe(revision);
    const internal = marketplace as unknown as {
      fetchRemoteManifest(entry: RegistryEntry): Promise<{ version: string }>;
    };
    expect((await internal.fetchRemoteManifest(registry[0])).version).toBe("1.0.0");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects an invalid remote commit before downloading executable files", async () => {
    const fetch = vi.fn(async () => Response.json({ sha: "main" }));
    vi.stubGlobal("fetch", fetch);
    await expect(service().getRegistry()).rejects.toThrow("Invalid plugin revision");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the same revision for directory listings, recursive listings and file contents", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("/contents/plugins/example?"))
          return Response.json([
            { name: "nested", path: "plugins/example/nested", type: "dir", download_url: null },
          ]);
        if (url.includes("/contents/plugins/example/nested?"))
          return Response.json([
            {
              name: "index.js",
              path: "plugins/example/nested/index.js",
              type: "file",
              download_url:
                "https://raw.githubusercontent.com/TONresistor/teleton-plugins/main/plugins/example/nested/index.js",
            },
          ]);
        if (url.includes(`/${revision}/plugins/example/nested/index.js`))
          return new Response("export default {};");
        throw new Error(`Unexpected URL: ${url}`);
      })
    );
    mkdirSync(state.directory, { recursive: true });
    const internal = service() as unknown as {
      downloadDir(path: string, directory: string, revision: string): Promise<void>;
    };
    await internal.downloadDir("plugins/example", state.directory, revision);
    expect(calls.slice(0, 2).every((url) => url.endsWith(`?ref=${revision}`))).toBe(true);
    expect(readFileSync(join(state.directory, "nested/index.js"), "utf8")).toBe(
      "export default {};"
    );
    expect(calls[2]).not.toContain("/main/");
  });
});
