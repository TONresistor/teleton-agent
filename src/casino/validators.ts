/**
 * Input validation utilities for Teleton Casino
 * Centralized validation for consistent error handling
 */

import { Address } from "@ton/core";
import { CASINO_CONFIG } from "./config.js";

export interface ValidationResult {
  valid: boolean;
  error?: string;
  sanitized?: string;
}

/**
 * Validate and sanitize Telegram username
 */
export function validateUsername(username: string | undefined | null): ValidationResult {
  if (!username) {
    return {
      valid: false,
      error: "Username is required",
    };
  }

  // Remove @ prefix and trim
  const sanitized = username.replace(/^@/, "").toLowerCase().trim();

  if (sanitized.length === 0) {
    return {
      valid: false,
      error: "Username cannot be empty",
    };
  }

  if (sanitized.length < 3) {
    return {
      valid: false,
      error: "Username too short (minimum 3 characters)",
    };
  }

  if (sanitized.length > 32) {
    return {
      valid: false,
      error: "Username too long (maximum 32 characters)",
    };
  }

  // Telegram username rules: a-z, 0-9, underscores
  if (!/^[a-z0-9_]+$/.test(sanitized)) {
    return {
      valid: false,
      error: "Invalid username format (only letters, numbers, underscores allowed)",
    };
  }

  return {
    valid: true,
    sanitized,
  };
}

/**
 * Validate TON wallet address
 */
export function validateWalletAddress(address: string | undefined | null): ValidationResult {
  if (!address) {
    return {
      valid: false,
      error: "Wallet address is required",
    };
  }

  const trimmed = address.trim();

  try {
    // Try to parse as TON address
    const parsed = Address.parse(trimmed);
    const normalized = parsed.toString({ bounceable: false });

    return {
      valid: true,
      sanitized: normalized,
    };
  } catch (e) {
    return {
      valid: false,
      error: `Invalid TON wallet address: ${trimmed}`,
    };
  }
}

/**
 * Validate bet amount
 */
export function validateBetAmount(
  amount: number | undefined | null,
  options?: {
    minBet?: number;
    maxBet?: number;
  }
): ValidationResult & { amount?: number } {
  const minBet = options?.minBet ?? CASINO_CONFIG.minBet;
  const maxBet = options?.maxBet ?? 1000; // Default max if not specified

  if (amount === undefined || amount === null) {
    return {
      valid: false,
      error: "Bet amount is required",
    };
  }

  if (typeof amount !== "number" || isNaN(amount)) {
    return {
      valid: false,
      error: "Bet amount must be a number",
    };
  }

  if (amount < minBet) {
    return {
      valid: false,
      error: `Minimum bet is ${minBet} TON`,
    };
  }

  if (amount > maxBet) {
    return {
      valid: false,
      error: `Maximum bet is ${maxBet.toFixed(2)} TON`,
    };
  }

  // Round to 2 decimal places
  const rounded = Math.round(amount * 100) / 100;

  return {
    valid: true,
    amount: rounded,
  };
}

/**
 * Validate chat ID
 */
export function validateChatId(chatId: string | undefined | null): ValidationResult {
  if (!chatId) {
    return {
      valid: false,
      error: "Chat ID is required",
    };
  }

  const trimmed = chatId.trim();

  // Chat IDs can be numeric (user IDs, group IDs) or @username format
  if (trimmed.length === 0) {
    return {
      valid: false,
      error: "Chat ID cannot be empty",
    };
  }

  return {
    valid: true,
    sanitized: trimmed,
  };
}

/**
 * Validate slot value (1-64)
 */
export function validateSlotValue(
  value: number | undefined | null
): ValidationResult & { value?: number } {
  if (value === undefined || value === null) {
    return {
      valid: false,
      error: "Slot value is required",
    };
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      valid: false,
      error: "Slot value must be an integer",
    };
  }

  if (value < 1 || value > 64) {
    return {
      valid: false,
      error: "Slot value must be between 1 and 64",
    };
  }

  return {
    valid: true,
    value,
  };
}

/**
 * Validate dice value (1-6)
 */
export function validateDiceValue(
  value: number | undefined | null
): ValidationResult & { value?: number } {
  if (value === undefined || value === null) {
    return {
      valid: false,
      error: "Dice value is required",
    };
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    return {
      valid: false,
      error: "Dice value must be an integer",
    };
  }

  if (value < 1 || value > 6) {
    return {
      valid: false,
      error: "Dice value must be between 1 and 6",
    };
  }

  return {
    valid: true,
    value,
  };
}
