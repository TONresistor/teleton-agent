import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiError, telegramAuthError } from "../http.js";

describe("WebUI HTTP errors", () => {
  it("emits one canonical API error envelope", async () => {
    const app = new Hono();
    app.get("/", (context) => apiError(context, new Error("broken"), 400));

    const response = await app.request("/");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: "broken" });
  });

  it("normalizes Telegram rate limits and GramJS messages", async () => {
    const app = new Hono();
    app.get("/limited", (context) => telegramAuthError(context, { seconds: 42 }));
    app.get("/telegram", (context) =>
      telegramAuthError(context, { errorMessage: "PHONE_CODE_INVALID" })
    );

    const limited = await app.request("/limited");
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      success: false,
      error: "Rate limited. Please wait 42 seconds.",
    });

    const telegram = await app.request("/telegram");
    expect(telegram.status).toBe(500);
    expect(await telegram.json()).toEqual({ success: false, error: "PHONE_CODE_INVALID" });
  });
});
