import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_balances tool
 */
interface JettonBalancesParams {
  // No parameters - uses agent's wallet
}

/**
 * Jetton balance info
 */
interface JettonBalance {
  symbol: string;
  name: string;
  balance: string; // Human-readable balance
  rawBalance: string; // Raw blockchain units
  decimals: number;
  jettonAddress: string; // Master contract address
  walletAddress: string; // User's jetton wallet address
  verification: string; // whitelist/blacklist/none
  score: number; // 0-100 trust score
  image?: string;
}

/**
 * Tool definition for jetton_balances
 */
export const jettonBalancesTool: Tool = {
  name: "jetton_balances",
  description:
    "Get all Jetton (token) balances owned by the agent. Returns a list of all tokens with their balances, names, symbols, and verification status. Useful to check what tokens you currently hold.",
  parameters: Type.Object({}),
  category: "data-bearing",
};

/**
 * Executor for jetton_balances tool
 */
export const jettonBalancesExecutor: ToolExecutor<JettonBalancesParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    // Load wallet
    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    // Fetch jetton balances from TonAPI
    const response = await fetchWithTimeout(
      `${TONAPI_BASE_URL}/accounts/${walletData.address}/jettons`,
      {
        headers: tonapiHeaders(),
      }
    );

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const data = await response.json();
    const balances: JettonBalance[] = [];

    // Parse each jetton balance
    for (const item of data.balances || []) {
      const { balance, wallet_address, jetton } = item;

      // Skip blacklisted/scam tokens
      if (jetton.verification === "blacklist") {
        continue;
      }

      // Convert balance from blockchain units to human-readable
      const decimals = jetton.decimals || 9;
      const rawBalance = BigInt(balance);
      const divisor = BigInt(10 ** decimals);
      const wholePart = rawBalance / divisor;
      const fractionalPart = rawBalance % divisor;

      // Format balance with decimals
      const formattedBalance =
        fractionalPart === BigInt(0)
          ? wholePart.toString()
          : `${wholePart}.${fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "")}`;

      balances.push({
        symbol: jetton.symbol || "UNKNOWN",
        name: jetton.name || "Unknown Token",
        balance: formattedBalance,
        rawBalance: balance,
        decimals,
        jettonAddress: jetton.address,
        walletAddress: wallet_address.address,
        verification: jetton.verification || "none",
        score: jetton.score || 0,
        image: jetton.image,
      });
    }

    // Sort by verification score (whitelisted first, then by score)
    balances.sort((a, b) => {
      if (a.verification === "whitelist" && b.verification !== "whitelist") return -1;
      if (a.verification !== "whitelist" && b.verification === "whitelist") return 1;
      return b.score - a.score;
    });

    // Build summary message
    const totalJettons = balances.length;
    const whitelisted = balances.filter((b) => b.verification === "whitelist").length;

    let message = `You own ${totalJettons} jetton${totalJettons !== 1 ? "s" : ""}`;
    if (whitelisted > 0) {
      message += ` (${whitelisted} verified)`;
    }

    if (totalJettons === 0) {
      message = "You don't own any jettons yet.";
    } else {
      message += ":\n\n";
      balances.forEach((b) => {
        const verifiedIcon = b.verification === "whitelist" ? "✅" : "";
        message += `${verifiedIcon} ${b.symbol}: ${b.balance}\n`;
        message += `   ${b.name}\n`;
        if (b.verification !== "whitelist" && b.verification !== "none") {
          message += `   ⚠️ ${b.verification}\n`;
        }
      });
    }

    // Build compact summary for truncation/masking
    let summary = `${totalJettons} jetton${totalJettons !== 1 ? "s" : ""}`;
    if (whitelisted > 0) {
      summary += ` (${whitelisted} verified)`;
    }
    if (totalJettons > 0) {
      const topTokens = balances.slice(0, 5).map((b) => `${b.symbol} ${b.balance}`);
      summary += `: ${topTokens.join(", ")}`;
      if (balances.length > 5) summary += `, +${balances.length - 5} more`;
    }

    return {
      success: true,
      data: {
        totalJettons,
        whitelisted,
        balances,
        message,
        summary,
      },
    };
  } catch (error) {
    console.error("Error in jetton_balances:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
