import { describe, expect, it } from "vitest";
import { getLoopBudgetStop } from "../runtime-utils.js";

describe("getLoopBudgetStop", () => {
  it("does not stop before the duration budget", () => {
    expect(getLoopBudgetStop(true, 999, 1000)).toBeNull();
  });

  it("stops at the duration budget when a response exists", () => {
    expect(getLoopBudgetStop(true, 1000, 1000)).toEqual({
      stopReason: "time_budget",
      forcedContent:
        "I stopped at a safe boundary because this turn reached its time budget. " +
        "Send a follow-up to continue.",
    });
  });

  it("fails clearly when the first response exceeds the budget", () => {
    expect(() => getLoopBudgetStop(false, 1001, 1000)).toThrow(
      "Agent turn time budget exhausted before the first model response"
    );
  });
});
