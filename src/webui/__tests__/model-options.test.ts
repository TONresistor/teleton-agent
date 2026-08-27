import { describe, expect, it } from "vitest";
import { mergeModelOptions } from "../../../web/src/lib/model-options.js";

const CATALOG = [
  { value: "claude-fable-5", name: "Claude Fable 5" },
  { value: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
];

describe("WebUI model options", () => {
  it("keeps a configured custom or legacy model without replacing it", () => {
    expect(mergeModelOptions(CATALOG, "custom/provider-model")).toEqual([
      ...CATALOG,
      { value: "custom/provider-model", name: "custom/provider-model" },
    ]);
  });

  it("does not duplicate a configured catalog model", () => {
    expect(mergeModelOptions(CATALOG, "claude-haiku-4-5-20251001")).toEqual(CATALOG);
  });

  it("does not add an empty configured model", () => {
    expect(mergeModelOptions(CATALOG, "")).toEqual(CATALOG);
  });
});
