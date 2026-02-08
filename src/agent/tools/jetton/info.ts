import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { fetchWithTimeout } from "../../../utils/fetch.js";
import { TONAPI_BASE_URL, tonapiHeaders } from "../../../constants/api-endpoints.js";

/**
 * Parameters for jetton_info tool
 */
interface JettonInfoParams {
  jetton_address: string;
}

/**
 * Tool definition for jetton_info
 */
export const jettonInfoTool: Tool = {
  name: "jetton_info",
  description:
    "Get detailed information about a Jetton (token) by its master contract address. Returns name, symbol, decimals, total supply, holders count, and verification status. Useful to research a token before buying or sending.",
  parameters: Type.Object({
    jetton_address: Type.String({
      description: "Jetton master contract address (EQ... or 0:... format)",
    }),
  }),
};

/**
 * Executor for jetton_info tool
 */
export const jettonInfoExecutor: ToolExecutor<JettonInfoParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const { jetton_address } = params;

    // Fetch jetton info from TonAPI
    const response = await fetchWithTimeout(`${TONAPI_BASE_URL}/jettons/${jetton_address}`, {
      headers: tonapiHeaders(),
    });

    if (response.status === 404) {
      return {
        success: false,
        error: `Jetton not found: ${jetton_address}. Make sure you're using the master contract address.`,
      };
    }

    if (!response.ok) {
      return {
        success: false,
        error: `TonAPI error: ${response.status}`,
      };
    }

    const data = await response.json();
    const metadata = data.metadata || {};

    // Format total supply
    const decimals = parseInt(metadata.decimals || "9");
    const totalSupplyRaw = BigInt(data.total_supply || "0");
    const divisor = BigInt(10 ** decimals);
    const totalSupplyWhole = totalSupplyRaw / divisor;
    const totalSupplyFormatted = formatLargeNumber(Number(totalSupplyWhole));

    // Build response
    const jettonInfo = {
      name: metadata.name || "Unknown",
      symbol: metadata.symbol || "UNKNOWN",
      decimals,
      description: metadata.description || null,
      image: data.preview || metadata.image || null,
      address: metadata.address || jetton_address,
      totalSupply: totalSupplyFormatted,
      totalSupplyRaw: data.total_supply,
      holdersCount: data.holders_count || 0,
      mintable: data.mintable || false,
      verification: data.verification || "none",
      admin: data.admin?.address || null,
    };

    // Build human-readable message
    const verificationIcon =
      jettonInfo.verification === "whitelist"
        ? "✅"
        : jettonInfo.verification === "blacklist"
          ? "🚫"
          : "⚠️";

    let message = `${verificationIcon} ${jettonInfo.name} (${jettonInfo.symbol})\n`;
    message += `Address: ${jettonInfo.address}\n`;
    message += `Decimals: ${jettonInfo.decimals}\n`;
    message += `Total Supply: ${jettonInfo.totalSupply}\n`;
    message += `Holders: ${jettonInfo.holdersCount.toLocaleString()}\n`;
    message += `Verification: ${jettonInfo.verification}`;
    if (jettonInfo.mintable) {
      message += `\nMintable: Yes`;
    }
    if (jettonInfo.description) {
      message += `\n\n${jettonInfo.description}`;
    }

    return {
      success: true,
      data: {
        ...jettonInfo,
        message,
      },
    };
  } catch (error) {
    console.error("Error in jetton_info:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

/**
 * Format large numbers with K, M, B suffixes
 */
function formatLargeNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(2) + "B";
  } else if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(2) + "M";
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(2) + "K";
  }
  return num.toLocaleString();
}
