import type { JettonHistory, JettonHolder, JettonPrice, PluginLogger } from "@teleton-agent/sdk";
import { GECKOTERMINAL_API_URL, tonapiFetch } from "../../constants/api-endpoints.js";
import { fetchWithTimeout } from "../../utils/fetch.js";
import { fetchJettonMeta, formatTokenBalance } from "./jetton-api.js";

interface TonApiJettonHolder {
  address?: string;
  owner?: { address?: string; name?: string };
  balance: string;
}

export function createJettonAnalyticsSDK(log: PluginLogger): {
  getJettonPrice(jettonAddress: string): Promise<JettonPrice | null>;
  getJettonHolders(jettonAddress: string, limit?: number): Promise<JettonHolder[]>;
  getJettonHistory(jettonAddress: string): Promise<JettonHistory | null>;
} {
  return {
    async getJettonPrice(jettonAddress) {
      try {
        const response = await tonapiFetch(
          `/rates?tokens=${encodeURIComponent(jettonAddress)}&currencies=usd,ton`
        );
        if (!response.ok) {
          log.debug(`ton.getJettonPrice() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        const rateData = data.rates?.[jettonAddress];
        if (!rateData) return null;

        return {
          priceUSD: rateData.prices?.USD ?? null,
          priceTON: rateData.prices?.TON ?? null,
          change24h: rateData.diff_24h?.USD ?? null,
          change7d: rateData.diff_7d?.USD ?? null,
          change30d: rateData.diff_30d?.USD ?? null,
        };
      } catch (error) {
        log.debug("ton.getJettonPrice() failed:", error);
        return null;
      }
    },

    async getJettonHolders(jettonAddress, limit) {
      try {
        const effectiveLimit = Math.min(limit ?? 10, 100);
        const [holdersResponse, info] = await Promise.all([
          tonapiFetch(
            `/jettons/${encodeURIComponent(jettonAddress)}/holders?limit=${effectiveLimit}`
          ),
          fetchJettonMeta(jettonAddress),
        ]);

        if (!holdersResponse.ok) {
          log.debug(`ton.getJettonHolders() TonAPI error: ${holdersResponse.status}`);
          return [];
        }

        const data = await holdersResponse.json();
        const addresses = data.addresses || [];
        const decimals = info.meta?.decimals ?? 9;

        return addresses.map((holder: TonApiJettonHolder, index: number) => ({
          rank: index + 1,
          address: holder.owner?.address || holder.address,
          name: holder.owner?.name || null,
          balance: formatTokenBalance(BigInt(holder.balance || "0"), decimals),
          balanceRaw: holder.balance || "0",
        }));
      } catch (error) {
        log.debug("ton.getJettonHolders() failed:", error);
        return [];
      }
    },

    async getJettonHistory(jettonAddress) {
      try {
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
            const fmtUsd = (raw: string): string => {
              const value = parseFloat(raw);
              return Number.isFinite(value)
                ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : "N/A";
            };
            if (attrs.volume_usd?.h24) volume24h = fmtUsd(attrs.volume_usd.h24);
            if (attrs.fdv_usd) fdv = fmtUsd(attrs.fdv_usd);
            if (attrs.market_cap_usd) marketCap = fmtUsd(attrs.market_cap_usd);
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
      } catch (error) {
        log.debug("ton.getJettonHistory() failed:", error);
        return null;
      }
    },
  };
}
