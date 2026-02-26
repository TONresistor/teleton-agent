import { Type } from "@sinclair/typebox";
import { Address } from "@ton/core";
import type { Tool, ToolExecutor, ToolResult } from "../types.js";
import { loadWallet } from "../../../ton/wallet-service.js";
import { sendTon } from "../../../ton/transfer.js";
import { getErrorMessage } from "../../../utils/errors.js";
import { createLogger } from "../../../utils/logger.js";

const log = createLogger("Tools");
interface SendParams {
  to: string;
  amount: number;
  comment?: string;
}
export const tonSendTool: Tool = {
  name: "ton_send",
  description:
    "Send TON to an address. Amount in TON (not nanoTON). Use a REAL address from the user or from ton_address_book — never guess addresses. Confirm details before sending.",
  parameters: Type.Object({
    to: Type.String({
      description:
        "Recipient TON address (EQ... or UQ... format). Must be a real, valid address — do not fabricate.",
    }),
    amount: Type.Number({
      description: "Amount to send in TON (e.g., 1.5 for 1.5 TON)",
      minimum: 0.001,
    }),
    comment: Type.Optional(
      Type.String({
        description: "Optional comment/memo for the transaction",
      })
    ),
  }),
};
export const tonSendExecutor: ToolExecutor<SendParams> = async (
  params,
  _context
): Promise<ToolResult> => {
  try {
    const { to, amount, comment } = params;

    // Validate address format before attempting transfer
    try {
      Address.parse(to);
    } catch {
      return {
        success: false,
        error: `Invalid recipient address: ${to}. TON addresses must have a valid checksum. Ask the user for the correct address.`,
      };
    }

    const walletData = loadWallet();
    if (!walletData) {
      return {
        success: false,
        error: "Wallet not initialized. Contact admin to generate wallet.",
      };
    }

    const txRef = await sendTon({ toAddress: to, amount, comment });

    if (!txRef) {
      return {
        success: false,
        error: "TON transfer failed — check blockchain node connectivity.",
      };
    }

    return {
      success: true,
      data: {
        to,
        amount,
        comment: comment || null,
        from: walletData.address,
        message: `Sent ${amount} TON to ${to}${comment ? ` (${comment})` : ""}`,
      },
    };
  } catch (error) {
    log.error({ err: error }, "Error in ton_send");
    return {
      success: false,
      error: getErrorMessage(error),
    };
  }
};
