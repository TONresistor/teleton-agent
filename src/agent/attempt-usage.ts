import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  ProviderStreamOptions,
  Usage,
} from "@earendil-works/pi-ai/compat";
import { complete } from "@earendil-works/pi-ai/compat";
import {
  createOpenRouterUsageTracker,
  type CostAwareUsage,
} from "../providers/openrouter-usage.js";
import { isCustomOpenRouterModel } from "../providers/model-resolver.js";
import { fitPreparedContext, prepareContextBudget } from "./context-budget.js";
import { TurnBudgetError } from "./turn-budget.js";

export interface ModelAttemptUsage {
  attemptId: string;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  provider: string;
  model: string;
  purpose: string;
  stopReason?: AssistantMessage["stopReason"];
  usage?: Usage;
  /** Local interruption does not establish that the provider has stopped. */
  inFlight?: boolean;
  incomplete: boolean;
}
export interface UsageCollector {
  deadlineAt?: number;
  signal?: AbortSignal;
  attempts: ModelAttemptUsage[];
  /** Called again with the same attemptId if a locally interrupted request settles later. */
  onAttempt?: (attempt: ModelAttemptUsage) => void | Promise<void>;
}
const storage = new AsyncLocalStorage<UsageCollector>();
const inFlight = new Set<Promise<unknown>>();
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 120_000;
export function createUsageCollector(): UsageCollector {
  return { attempts: [] };
}
export function runWithUsageCollector<T>(collector: UsageCollector, fn: () => T): T {
  return storage.run(collector, fn);
}
/** Track actual model/credential work, independently of a local wait deadline. */
export function trackModelWork<T>(promise: Promise<T>): Promise<T> {
  inFlight.add(promise);
  void promise.then(
    () => inFlight.delete(promise),
    () => inFlight.delete(promise)
  );
  return promise;
}
export function getInFlightModelRequests(): number {
  return inFlight.size;
}
function publish(collector: UsageCollector | undefined, attempt: ModelAttemptUsage): void {
  if (!collector) return;
  const existing = collector.attempts.findIndex((item) => item.attemptId === attempt.attemptId);
  if (existing >= 0) collector.attempts[existing] = attempt;
  else collector.attempts.push(attempt);
  try {
    const result = collector.onAttempt?.(structuredClone(attempt));
    if (result) void result.catch(() => {});
  } catch {
    /* Accounting persistence cannot overwrite a provider result. */
  }
}
function attemptRecord(
  model: Pick<Model<Api>, "provider" | "id">,
  purpose: string,
  attemptId: string,
  startedAt: number,
  response?: AssistantMessage,
  pending = false
): ModelAttemptUsage {
  const usage = response?.usage;
  const known =
    !!usage &&
    [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].every(Number.isFinite) &&
    (usage.totalTokens > 0 || usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0);
  const completedAt = Date.now();
  return {
    attemptId,
    startedAt,
    completedAt,
    durationMs: Math.max(0, completedAt - startedAt),
    provider: model.provider,
    model: model.id,
    purpose,
    stopReason: response?.stopReason ?? (pending ? "aborted" : undefined),
    usage: usage ? structuredClone(usage) : undefined,
    inFlight: pending,
    incomplete: !known || (usage as CostAwareUsage | undefined)?.costIncomplete === true,
  };
}
export interface ModelRequestBoundary {
  signal: AbortSignal;
  timeoutMs: number;
  deadlineAt: number;
  dispose(): void;
}
export function assertModelRequestAllowed(signal?: AbortSignal): void {
  const collector = storage.getStore();
  if (
    signal?.aborted ||
    collector?.signal?.aborted ||
    (collector?.deadlineAt !== undefined && Date.now() >= collector.deadlineAt)
  )
    throw new TurnBudgetError();
}
/** One disposable deadline shared by SDK transport and local waiting. */
export function createModelRequestBoundary(options: {
  signal?: AbortSignal;
  timeoutMs?: number;
}): ModelRequestBoundary {
  assertModelRequestAllowed(options.signal);
  const now = Date.now();
  const collector = storage.getStore();
  const timeoutMs = Math.floor(
    Math.min(
      options.timeoutMs ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
      collector?.deadlineAt === undefined ? Infinity : collector.deadlineAt - now
    )
  );
  if (timeoutMs <= 0) throw new TurnBudgetError();
  const controller = new AbortController();
  const signals = [options.signal, collector?.signal].filter(
    (signal): signal is AbortSignal => !!signal
  );
  const abort = () => controller.abort();
  for (const signal of signals) signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    timeoutMs,
    deadlineAt: now + timeoutMs,
    dispose() {
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", abort);
    },
  };
}
/** Use only for model/credential reads; never use this to interrupt an action executor. */
export function raceModelPromise<T>(
  promise: Promise<T>,
  boundary: ModelRequestBoundary,
  onInterrupted?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const cleanup = () => boundary.signal.removeEventListener("abort", abort);
    const abort = () => {
      if (done) return;
      done = true;
      cleanup();
      onInterrupted?.();
      reject(new TurnBudgetError());
    };
    boundary.signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        if (done) return;
        if (boundary.signal.aborted || Date.now() >= boundary.deadlineAt) {
          abort();
          return;
        }
        done = true;
        cleanup();
        resolve(value);
      },
      (error) => {
        if (done) return;
        if (boundary.signal.aborted || Date.now() >= boundary.deadlineAt) {
          abort();
          return;
        }
        done = true;
        cleanup();
        reject(error);
      }
    );
    if (boundary.signal.aborted) abort();
  });
}

export async function performTrackedModelRequest(
  model: Model<Api>,
  purpose: string,
  operation: (boundary: ModelRequestBoundary) => Promise<AssistantMessage>,
  options: { signal?: AbortSignal; timeoutMs?: number },
  finalizeUsage?: (response: AssistantMessage) => void
): Promise<AssistantMessage> {
  const boundary = createModelRequestBoundary(options);
  const collector = storage.getStore();
  const attemptId = randomUUID();
  const startedAt = Date.now();
  let settled = false;
  let actual: Promise<AssistantMessage>;
  try {
    actual = Promise.resolve(operation(boundary));
  } catch (error) {
    actual = Promise.reject(error);
  }
  const tracked = actual.then(
    (response) => {
      settled = true;
      finalizeUsage?.(response);
      publish(collector, attemptRecord(model, purpose, attemptId, startedAt, response));
      return response;
    },
    (error) => {
      settled = true;
      publish(collector, attemptRecord(model, purpose, attemptId, startedAt));
      throw error;
    }
  );
  void trackModelWork(tracked);
  try {
    return await raceModelPromise(tracked, boundary, () => {
      if (!settled)
        publish(collector, attemptRecord(model, purpose, attemptId, startedAt, undefined, true));
    });
  } finally {
    boundary.dispose();
  }
}

/** Utility requests share the turn collector and final payload/deadline gates. */
export async function completeUtility(
  model: Model<Api>,
  context: Context,
  options: ProviderStreamOptions,
  purpose: string
): Promise<AssistantMessage> {
  assertModelRequestAllowed(options.signal);
  const fittedContext = fitPreparedContext(model, context, options.maxTokens ?? model.maxTokens);
  const budget = prepareContextBudget(model, fittedContext, options.maxTokens ?? model.maxTokens);
  const tracker =
    model.provider === "openrouter" && model.api === "openai-completions"
      ? createOpenRouterUsageTracker(isCustomOpenRouterModel(model))
      : undefined;
  const response = await performTrackedModelRequest(
    model,
    purpose,
    (boundary) =>
      complete(model, fittedContext, {
        ...options,
        ...(tracker && { fetch: tracker.fetch }),
        maxTokens: budget.maxTokens,
        signal: boundary.signal,
        timeoutMs: boundary.timeoutMs,
      }),
    options,
    tracker?.apply
  );
  if (response.stopReason === "error" || response.stopReason === "aborted")
    throw new Error(response.errorMessage ?? `Utility request ${response.stopReason}`);
  return response;
}
