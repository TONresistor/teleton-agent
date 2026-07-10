import { Hono } from "hono";
import type { WebUIServerDeps, APIResponse } from "../types.js";
import { apiError } from "../http.js";
import {
  getWalletAddress,
  getWalletBalance,
  getCachedTonClient,
} from "../../ton/wallet-service.js";
import { Address } from "@ton/core";
import { formatTransactions } from "../../ton/format-transactions.js";

export function createWalletRoutes(_deps: WebUIServerDeps) {
  const app = new Hono();

  // GET / — wallet address + balance
  app.get("/", async (c) => {
    try {
      const address = getWalletAddress();
      if (!address) {
        const response: APIResponse<{ address: null; balance: string }> = {
          success: true,
          data: { address: null, balance: "0" },
        };
        return c.json(response);
      }

      const balanceResult = await getWalletBalance(address);
      const response: APIResponse<{ address: string; balance: string }> = {
        success: true,
        data: {
          address,
          balance: balanceResult?.balance ?? "0",
        },
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  // GET /transactions — recent transactions
  app.get("/transactions", async (c) => {
    try {
      const address = getWalletAddress();
      if (!address) {
        const response: APIResponse = {
          success: false,
          error: "No wallet configured",
        };
        return c.json(response, 404);
      }

      const limit = Math.min(Number(c.req.query("limit") || "20"), 50);
      const client = await getCachedTonClient();
      const addressObj = Address.parse(address);
      const transactions = await client.getTransactions(addressObj, { limit });
      const formatted = formatTransactions(transactions);

      const response: APIResponse<typeof formatted> = {
        success: true,
        data: formatted,
      };
      return c.json(response);
    } catch (error) {
      return apiError(c, error, 500);
    }
  });

  return app;
}
