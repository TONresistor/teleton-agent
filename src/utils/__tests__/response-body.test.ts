import { afterEach, describe, expect, it, vi } from "vitest";
import { readResponseBuffer } from "../response-body.js";
import { fetchWithTimeout } from "../fetch.js";

afterEach(() => vi.unstubAllGlobals());

describe("bounded download buffering", () => {
  it("rejects an oversized declared body before reading it and cancels its stream", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { "content-length": "101" },
    });
    await expect(readResponseBuffer(response, 100)).rejects.toThrow("Download exceeds size limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("enforces the byte limit even when content-length understates the body", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(4));
      },
      cancel,
    });
    const response = new Response(stream, { headers: { "content-length": "2" } });
    await expect(readResponseBuffer(response, 5)).rejects.toThrow("Download exceeds size limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("accepts exactly the limit across multiple chunks without content-length", async () => {
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.enqueue(new TextEncoder().encode("world"));
          controller.close();
        },
      })
    );
    await expect(readResponseBuffer(response, 10)).resolves.toEqual(Buffer.from("helloworld"));
    expect(response.body?.locked).toBe(false);
  });

  it("releases the body lock after a stream fails", async () => {
    const failure = new Error("connection dropped");
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      })
    );
    await expect(readResponseBuffer(response, 10)).rejects.toBe(failure);
    expect(response.body?.locked).toBe(false);
  });

  it("returns an empty buffer for a bodyless response", async () => {
    await expect(readResponseBuffer(new Response(null, { status: 204 }), 10)).resolves.toEqual(
      Buffer.alloc(0)
    );
  });
});

function mockStalledDownload(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const signal = init.signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            signal?.addEventListener("abort", () => controller.error(signal.reason), {
              once: true,
            });
          },
        })
      );
    })
  );
}

describe("download cancellation", () => {
  it("keeps the caller's abort signal active while consuming the response body", async () => {
    mockStalledDownload();
    const controller = new AbortController();
    const response = await fetchWithTimeout("https://test.invalid/download", {
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    const pending = readResponseBuffer(response, 100);
    controller.abort(new DOMException("User cancelled", "AbortError"));
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "User cancelled" });
    expect(response.body?.locked).toBe(false);
  });

  it("retains the download deadline when the caller supplies a separate signal", async () => {
    mockStalledDownload();
    const controller = new AbortController();
    const response = await fetchWithTimeout("https://test.invalid/download", {
      signal: controller.signal,
      timeoutMs: 20,
    });
    await expect(readResponseBuffer(response, 100)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(controller.signal.aborted).toBe(false);
    expect(response.body?.locked).toBe(false);
  });
});
