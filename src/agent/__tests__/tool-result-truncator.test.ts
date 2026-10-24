import { describe, expect, it } from "vitest";
import { attachArtifactReference, truncateToolResult } from "../tool-result-truncator.js";

describe("bounded tool result projection", () => {
  it("bounds nested data and long summaries without discarding the action receipt", () => {
    const result = {
      success: true,
      execution: { outcome: "succeeded", remoteId: "tx-1" },
      data: { summary: '\\"'.repeat(20_000), nested: { payload: "x".repeat(100_000) } },
    };
    const text = truncateToolResult(result, 1000);
    expect(text.length).toBeLessThanOrEqual(1000);
    expect(JSON.parse(text).execution).toEqual(result.execution);
    expect(
      JSON.parse(attachArtifactReference(text, { id: "artifact-1", sizeBytes: 200_000 })).data
        ._artifact.id
    ).toBe("artifact-1");
  });
  it("keeps uncertain outcomes explicitly non-retryable when reducing data", () => {
    const text = truncateToolResult(
      {
        success: false,
        error: "deadline",
        data: { outcome: "unknown", retryable: false, payload: "x".repeat(100_000) },
      },
      1000
    );
    expect(JSON.parse(text)).toMatchObject({
      success: false,
      error: "deadline",
      data: { outcome: "unknown", retryable: false },
    });
  });
});
