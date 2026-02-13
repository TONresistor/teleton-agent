import { Type } from "@sinclair/typebox";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { tonapiFetch } from "../../../constants/api-endpoints.js";

interface ChartParams {
  token?: string;
  period?: string;
}

export const tonChartTool: Tool = {
  name: "ton_chart",
  description:
    "Get price history chart for TON or any jetton. Returns price points over a time period with stats (min, max, change %). Use token param for jettons (master contract address).",
  parameters: Type.Object({
    token: Type.Optional(
      Type.String({
        description:
          'Token identifier: "ton" for TON, or a jetton master contract address. Defaults to "ton".',
      })
    ),
    period: Type.Optional(
      Type.String({
        description: 'Time period: "1h", "24h", "7d", "30d", "90d", "1y". Defaults to "7d".',
      })
    ),
  }),
  category: "data-bearing",
};

const PERIOD_CONFIG: Record<string, { seconds: number; points: number }> = {
  "1h": { seconds: 3600, points: 60 },
  "24h": { seconds: 86400, points: 96 },
  "7d": { seconds: 604800, points: 168 },
  "30d": { seconds: 2592000, points: 120 },
  "90d": { seconds: 7776000, points: 180 },
  "1y": { seconds: 31536000, points: 200 },
};

export const tonChartExecutor: ToolExecutor<ChartParams> = async (
  params,
  context
): Promise<ToolResult> => {
  try {
    const token = params.token || "ton";
    const period = params.period || "7d";

    const config = PERIOD_CONFIG[period];
    if (!config) {
      return {
        success: false,
        error: `Invalid period "${period}". Use one of: ${Object.keys(PERIOD_CONFIG).join(", ")}`,
      };
    }

    const endDate = Math.floor(Date.now() / 1000);
    const startDate = endDate - config.seconds;

    const url = `/rates/chart?token=${encodeURIComponent(token)}&currency=usd&start_date=${startDate}&end_date=${endDate}&points_count=${config.points}`;
    const res = await tonapiFetch(url);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        success: false,
        error: `TonAPI returned ${res.status}: ${text || res.statusText}`,
      };
    }

    const data = await res.json();

    if (!Array.isArray(data.points) || data.points.length === 0) {
      return {
        success: false,
        error: `No price data available for token "${token}" over period "${period}".`,
      };
    }

    const rawPoints: [number, number][] = data.points;

    // Points come in reverse chronological order — reverse to chronological
    const sorted = [...rawPoints].sort((a, b) => a[0] - b[0]);

    const points = sorted.map(([ts, price]) => ({
      timestamp: ts,
      date: new Date(ts * 1000).toISOString(),
      price,
    }));

    const prices = points.map((p) => p.price);
    const startPrice = prices[0];
    const currentPrice = prices[prices.length - 1];
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const changeAbsolute = currentPrice - startPrice;
    const changePercent = startPrice !== 0 ? (changeAbsolute / startPrice) * 100 : 0;

    const minIdx = prices.indexOf(minPrice);
    const maxIdx = prices.indexOf(maxPrice);

    const stats = {
      currentPrice,
      startPrice,
      minPrice,
      maxPrice,
      changePercent: Math.round(changePercent * 100) / 100,
      changeAbsolute: Math.round(changeAbsolute * 1e6) / 1e6,
      high: { price: maxPrice, date: points[maxIdx].date },
      low: { price: minPrice, date: points[minIdx].date },
    };

    const direction = changePercent >= 0 ? "+" : "";
    const tokenLabel = token === "ton" ? "TON" : token;
    const message = `${tokenLabel} price over ${period}: $${currentPrice.toFixed(4)} (${direction}${stats.changePercent}%). Low: $${minPrice.toFixed(4)}, High: $${maxPrice.toFixed(4)}. ${points.length} data points.`;

    return {
      success: true,
      data: {
        token: tokenLabel,
        period,
        points,
        stats,
        message,
      },
    };
  } catch (error) {
    console.error("Error in ton_chart:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
