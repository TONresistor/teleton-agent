import type {
  InlineRouter,
  PluginBotHandlers,
  PluginBotRegistrationTarget,
} from "../../bot/inline-router.js";
import { clonePluginBotHandlers } from "../../bot/inline-router.js";

export function botRegistrationShape(handlers: PluginBotHandlers | null): string {
  if (!handlers) return "none";
  return JSON.stringify({
    inline: Boolean(handlers.onInlineQuery),
    callbacks: handlers.onCallback?.map((entry) => entry.pattern) ?? [],
    chosen: Boolean(handlers.onChosenResult),
  });
}

/** Collects candidate Bot SDK registrations without mutating the live router. */
export class StagedBotRegistrar implements PluginBotRegistrationTarget {
  private readonly handlers = new Map<string, PluginBotHandlers>();
  private liveTarget: InlineRouter | null = null;

  registerPlugin(name: string, handlers: PluginBotHandlers): void {
    const snapshot = clonePluginBotHandlers(handlers);
    this.handlers.set(name, snapshot);
    this.liveTarget?.registerPlugin(name, snapshot);
  }

  getPluginHandlers(name: string): PluginBotHandlers | null {
    const handlers = this.handlers.get(name);
    return handlers ? clonePluginBotHandlers(handlers) : null;
  }

  activate(liveTarget: InlineRouter, oldPluginId: string, newPluginId: string): void {
    if (oldPluginId !== newPluginId) liveTarget.unregisterPlugin(oldPluginId);
    liveTarget.replacePlugin(newPluginId, this.getPluginHandlers(newPluginId));
    this.liveTarget = liveTarget;
  }

  deactivate(): void {
    this.liveTarget = null;
  }
}
