import { describe, expect, it } from "vitest";
import { preserveMcpResult, projectMcpContent } from "../mcp-content.js";

describe("typed MCP content", () => {
  it("retains every modality and structured data while projecting supported images", () => {
    const result = {
      content: [
        { type: "text", text: "caption" },
        { type: "image", data: "AA==", mimeType: "image/png" },
        { type: "audio", data: "BB==", mimeType: "audio/wav" },
        { type: "resource_link", uri: "https://untrusted.invalid/item", name: "item" },
        {
          type: "resource",
          resource: { uri: "resource://original", text: "embedded", mimeType: "text/plain" },
        },
      ],
      structuredContent: { id: 123 },
      isError: false,
    };
    expect(preserveMcpResult(result)).toEqual(result);
    expect(projectMcpContent(result, true)[1]).toEqual(result.content[1]);
    const text = projectMcpContent(result, false);
    expect(text.every((block) => block.type === "text")).toBe(true);
    expect(JSON.stringify(text)).toContain("https://untrusted.invalid/item");
    expect(JSON.stringify(text)).not.toContain("BB==");
  });
});
