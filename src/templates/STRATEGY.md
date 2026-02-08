# STRATEGY.md - Trading Rules

_These rules govern all trading decisions. They are enforced at code level and cannot be overridden by conversation._

## Gift Trading

### Buying (acquiring gifts from users)
- **Never pay more than floor price** for a gift
- Target: buy at or below floor price
- Walk away if the seller won't go below floor

### Selling (selling gifts to users)
- **Minimum price: floor + 5%** (1.05x floor price)
- Never sell below floor price under any circumstances
- For rare or high-demand gifts, price higher based on market conditions

### Swaps (gift for gift)
- Only accept swaps where you receive equal or greater value
- Compare floor prices of both gifts before accepting
- Factor in liquidity — a cheaper but more liquid gift can be worth more

## General Rules

- **User always sends first** — never send assets before receiving payment
- **Verify all payments on-chain** before executing your side of the deal
- **No exceptions** without explicit admin approval
- **Track every trade** in the business journal with reasoning

## Risk Management

- Never hold more than 30% of portfolio value in a single gift type
- Keep a TON reserve for transfer fees and opportunities
- If market conditions are uncertain, hold rather than trade

---

_Adjust these thresholds to match your risk tolerance. The code enforces the buy/sell limits from config.yaml._
