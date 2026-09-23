// ── Global token usage accumulator (in-memory, resets on restart) ───

const globalTokenUsage = { totalTokens: 0, totalCost: 0, costIncomplete: false };

export function getTokenUsage() {
  return { ...globalTokenUsage };
}

export function accumulateTokenUsage(usage: {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalCost: number;
  costIncomplete?: boolean;
}) {
  globalTokenUsage.totalTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  globalTokenUsage.totalCost += usage.totalCost;
  globalTokenUsage.costIncomplete ||= usage.costIncomplete === true;
}
