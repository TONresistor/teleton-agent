export class TurnBudgetError extends Error {
  constructor(public readonly reason = "time_budget") {
    super("Agent turn time budget exhausted");
  }
}

export function assertTurnBudget(deadline?: number, signal?: AbortSignal): void {
  if (signal?.aborted || (deadline !== undefined && Date.now() >= deadline))
    throw new TurnBudgetError();
}

export async function budgetSleep(
  ms: number,
  deadline: number,
  signal?: AbortSignal
): Promise<void> {
  assertTurnBudget(deadline, signal);
  if (ms >= deadline - Date.now()) throw new TurnBudgetError();
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new TurnBudgetError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
