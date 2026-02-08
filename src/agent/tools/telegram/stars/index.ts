// Note: send-stars and send-stars-gift removed - they don't actually transfer Stars
// Telegram doesn't have an API to transfer Stars between users
// Stars can only be used to: tip creators, buy gifts, purchase digital goods

export { telegramGetStarsBalanceTool, telegramGetStarsBalanceExecutor } from "./get-balance.js";
export {
  telegramGetStarsTransactionsTool,
  telegramGetStarsTransactionsExecutor,
} from "./get-transactions.js";
