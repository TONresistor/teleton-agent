/**
 * Strategy checker - enforces STRATEGY.md trading rules at code level
 *
 * RULES from STRATEGY.md:
 * - When BUYING (agent buys gift): Pay max buyMaxMultiplier of floor price
 * - When SELLING (agent sells gift): Charge min sellMinMultiplier of floor price
 * - User ALWAYS sends first (TON or gift)
 * - No exceptions without explicit admin approval
 */

import { DEALS_CONFIG } from "./config.js";

export interface StrategyCheck {
  acceptable: boolean;
  reason?: string;
  rule: string;
  profit: number;
  floorPriceUsed?: number;
  percentageOfFloor?: number;
}

export interface AssetValue {
  type: "ton" | "gift";
  tonAmount?: number;
  giftSlug?: string;
  valueTon: number; // Estimated TON value
}

/**
 * Check if a deal complies with STRATEGY.md rules
 */
export function checkStrategyCompliance(
  userGives: AssetValue,
  agentGives: AssetValue
): StrategyCheck {
  const userValue = userGives.valueTon;
  const agentValue = agentGives.valueTon;
  const profit = userValue - agentValue;

  // Case 1: Agent BUYS gift (user gives gift, agent gives TON)
  if (userGives.type === "gift" && agentGives.type === "ton") {
    const maxAllowed = userValue * DEALS_CONFIG.strategy.buyMaxMultiplier;
    const percentageOfFloor = (agentValue / userValue) * 100;

    if (agentValue > maxAllowed) {
      return {
        acceptable: false,
        reason: `Strategy violation: Cannot pay more than ${Math.round(DEALS_CONFIG.strategy.buyMaxMultiplier * 100)}% of floor price. Gift worth ${userValue} TON, offering ${agentValue} TON (${percentageOfFloor.toFixed(0)}%). Max allowed: ${maxAllowed.toFixed(2)} TON.`,
        rule: `BUYING: max ${Math.round(DEALS_CONFIG.strategy.buyMaxMultiplier * 100)}% floor`,
        profit,
        floorPriceUsed: userValue,
        percentageOfFloor,
      };
    }

    return {
      acceptable: true,
      rule: `BUYING: ${percentageOfFloor.toFixed(0)}% of floor (compliant)`,
      profit,
      floorPriceUsed: userValue,
      percentageOfFloor,
    };
  }

  // Case 2: Agent SELLS gift (user gives TON, agent gives gift)
  if (userGives.type === "ton" && agentGives.type === "gift") {
    const minRequired = agentValue * DEALS_CONFIG.strategy.sellMinMultiplier;
    const percentageOfFloor = (userValue / agentValue) * 100;

    if (userValue < minRequired) {
      return {
        acceptable: false,
        reason: `Strategy violation: Must charge at least ${Math.round(DEALS_CONFIG.strategy.sellMinMultiplier * 100)}% of floor price. Gift worth ${agentValue} TON, receiving ${userValue} TON (${percentageOfFloor.toFixed(0)}%). Min required: ${minRequired.toFixed(2)} TON.`,
        rule: `SELLING: min ${Math.round(DEALS_CONFIG.strategy.sellMinMultiplier * 100)}% floor`,
        profit,
        floorPriceUsed: agentValue,
        percentageOfFloor,
      };
    }

    return {
      acceptable: true,
      rule: `SELLING: ${percentageOfFloor.toFixed(0)}% of floor (compliant)`,
      profit,
      floorPriceUsed: agentValue,
      percentageOfFloor,
    };
  }

  // Case 3: Gift ↔ Gift swap
  if (userGives.type === "gift" && agentGives.type === "gift") {
    // Simple rule: Agent must receive equal or more value
    if (userValue >= agentValue) {
      return {
        acceptable: true,
        rule: `SWAP: Fair exchange (agent receives ${userValue} TON value for ${agentValue} TON value)`,
        profit,
      };
    }

    return {
      acceptable: false,
      reason: `Strategy violation: Gift swap would lose value. Giving ${agentValue} TON value, receiving ${userValue} TON value. Loss: ${Math.abs(profit).toFixed(2)} TON.`,
      rule: "SWAP: no value loss",
      profit,
    };
  }

  // Case 4: TON ↔ TON (shouldn't happen, but handle it)
  if (userGives.type === "ton" && agentGives.type === "ton") {
    if (userValue >= agentValue) {
      return {
        acceptable: true,
        rule: "TON swap: profit or neutral",
        profit,
      };
    }

    return {
      acceptable: false,
      reason: `TON swap would lose ${Math.abs(profit).toFixed(2)} TON.`,
      rule: "TON swap: no loss",
      profit,
    };
  }

  // Edge case: shouldn't reach here
  return {
    acceptable: false,
    reason: "Unknown deal type combination",
    rule: "unknown",
    profit,
  };
}

/**
 * Format strategy check as JSON for storage in deals table
 */
export function formatStrategyCheckJSON(check: StrategyCheck): string {
  return JSON.stringify({
    acceptable: check.acceptable,
    reason: check.reason,
    rule: check.rule,
    profit: check.profit,
    floorPriceUsed: check.floorPriceUsed,
    percentageOfFloor: check.percentageOfFloor,
  });
}
