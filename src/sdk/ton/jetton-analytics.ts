import type { JettonHistory, JettonHolder, JettonPrice, PluginLogger } from "@teleton-agent/sdk";
import { tonapiFetch } from "../../constants/api-endpoints.js";
import { fetchJettonMarketHistory } from "../../ton/jetton-analytics-service.js";
import { fetchJettonMeta, formatTokenBalance } from "./jetton-api.js";
import { boundedLimit, requireNonEmpty } from "../validation.js";

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
      const normalizedAddress = requireNonEmpty(jettonAddress, "Jetton address");
      try {
        const response = await tonapiFetch(
          `/rates?tokens=${encodeURIComponent(normalizedAddress)}&currencies=usd,ton`
        );
        if (!response.ok) {
          log.debug(`ton.getJettonPrice() TonAPI error: ${response.status}`);
          return null;
        }

        const data = await response.json();
        const rateData = data.rates?.[normalizedAddress];
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
      const normalizedAddress = requireNonEmpty(jettonAddress, "Jetton address");
      const effectiveLimit = boundedLimit(limit, 10, 100);
      try {
        const [holdersResponse, info] = await Promise.all([
          tonapiFetch(
            `/jettons/${encodeURIComponent(normalizedAddress)}/holders?limit=${effectiveLimit}`
          ),
          fetchJettonMeta(normalizedAddress),
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
      const normalizedAddress = requireNonEmpty(jettonAddress, "Jetton address");
      try {
        return await fetchJettonMarketHistory(normalizedAddress);
      } catch (error) {
        log.debug("ton.getJettonHistory() failed:", error);
        return null;
      }
    },
  };
}
