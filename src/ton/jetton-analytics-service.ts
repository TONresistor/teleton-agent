import { GECKOTERMINAL_API_URL, tonapiFetch } from "../constants/api-endpoints.js";
import { fetchWithTimeout } from "../utils/fetch.js";

export interface JettonMarketHistory {
  symbol: string;
  name: string;
  currentPrice: string;
  currentPriceTON: string;
  changes: { "24h": string; "7d": string; "30d": string };
  volume24h: string;
  fdv: string;
  marketCap: string;
  holders: number;
}

function formatUsd(raw: string): string {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value)
    ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
    : "N/A";
}

/** Fetch and combine Jetton market data used by both core tools and the plugin SDK. */
export async function fetchJettonMarketHistory(
  jettonAddress: string
): Promise<JettonMarketHistory> {
  const [ratesResponse, geckoResponse, infoResponse] = await Promise.all([
    tonapiFetch(`/rates?tokens=${encodeURIComponent(jettonAddress)}&currencies=usd,ton`),
    fetchWithTimeout(`${GECKOTERMINAL_API_URL}/networks/ton/tokens/${jettonAddress}`, {
      headers: { Accept: "application/json" },
    }),
    tonapiFetch(`/jettons/${encodeURIComponent(jettonAddress)}`),
  ]);

  let symbol = "TOKEN";
  let name = "Unknown Token";
  let holdersCount = 0;
  if (infoResponse.ok) {
    const infoData = await infoResponse.json();
    symbol = infoData.metadata?.symbol || symbol;
    name = infoData.metadata?.name || name;
    holdersCount = infoData.holders_count || 0;
  }

  let priceUSD: number | null = null;
  let priceTON: number | null = null;
  let change24h: string | null = null;
  let change7d: string | null = null;
  let change30d: string | null = null;
  if (ratesResponse.ok) {
    const ratesData = await ratesResponse.json();
    const rateInfo = ratesData.rates?.[jettonAddress];
    if (rateInfo) {
      priceUSD = rateInfo.prices?.USD || null;
      priceTON = rateInfo.prices?.TON || null;
      change24h = rateInfo.diff_24h?.USD || null;
      change7d = rateInfo.diff_7d?.USD || null;
      change30d = rateInfo.diff_30d?.USD || null;
    }
  }

  let volume24h = "N/A";
  let fdv = "N/A";
  let marketCap = "N/A";
  if (geckoResponse.ok) {
    const geckoData = await geckoResponse.json();
    const attrs = geckoData.data?.attributes;
    if (attrs) {
      if (attrs.volume_usd?.h24) volume24h = formatUsd(attrs.volume_usd.h24);
      if (attrs.fdv_usd) fdv = formatUsd(attrs.fdv_usd);
      if (attrs.market_cap_usd) marketCap = formatUsd(attrs.market_cap_usd);
    }
  }

  return {
    symbol,
    name,
    currentPrice: priceUSD ? `$${priceUSD.toFixed(6)}` : "N/A",
    currentPriceTON: priceTON ? `${priceTON.toFixed(6)} TON` : "N/A",
    changes: {
      "24h": change24h || "N/A",
      "7d": change7d || "N/A",
      "30d": change30d || "N/A",
    },
    volume24h,
    fdv,
    marketCap,
    holders: holdersCount,
  };
}
