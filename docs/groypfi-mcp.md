# teleton-plugin

This section documents the Teleton plugin integration for GroypFi products on TON.

## Files

- `plugins/groypfi-groypad.js` (Groypad launchpad integration)
- `plugins/groypfi-perps.js` (GroypFi Perps integration)

## Installation

1. Copy both plugin files into your Teleton `plugins/` directory.
2. Set `API_KEY` in each plugin.
3. Restart Teleton.

## `plugins/groypfi-groypad.js`

```javascript
// plugins/groypfi-groypad.js — Teleton plugin for Groypad (Bonding Curve Launchpad on TON)
// Repository: https://github.com/TONresistor/teleton-agent
//
// Groypad is a memecoin launchpad using linear bonding curves on TON.
// Contracts are Blumpad-compatible. Graduation target: 1,050 TON.
//
// MemeFactory: EQAO4cYqithwdltzmrlal1L5JKLK5Xk76feAJq0VoBC6Fy8T
// Deploy opcode: 0x6ff416dc → MemeFactory
// Buy opcode:    0x742b36d8 → Meme (jetton master)
// Sell opcode:   0x595f07bc → MemeWallet (user jetton wallet)
// Claim fee:     0xad7269a8 → Meme (jetton master)
//
// Docs: https://groypfi.io/docs/groypad

const MEME_FACTORY = "EQAO4cYqithwdltzmrlal1L5JKLK5Xk76feAJq0VoBC6Fy8T";
const SUPABASE_URL = "https://rcuesqclhdghrqrmwjlk.supabase.co";
const API_KEY = "<YOUR_SUPABASE_ANON_KEY>";
const PRECISION = BigInt(1e9);

// ── Bonding curve math ──

function integrateCurve(s1, s2, alpha, beta) {
  const dx = s2 - s1;
  if (dx <= 0n) return 0n;
  const term1 = (alpha * dx) / PRECISION;
  const term2 = (beta * dx * (s1 + s2)) / (2n * PRECISION * PRECISION);
  return term1 + term2;
}

function buyQuote(amountTon, currentSupply, alpha, beta) {
  const avgPrice = alpha + (beta * currentSupply) / PRECISION;
  if (avgPrice <= 0n) return 0n;
  let tokensOut = (amountTon * PRECISION) / avgPrice;

  for (let i = 0; i < 10; i++) {
    const cost = integrateCurve(currentSupply, currentSupply + tokensOut, alpha, beta);
    const diff = cost - amountTon;
    if (diff === 0n) break;
    const priceAtEnd = alpha + (beta * (currentSupply + tokensOut)) / PRECISION;
    if (priceAtEnd <= 0n) break;
    const adj = (diff * PRECISION) / priceAtEnd;
    tokensOut -= adj;
    if (tokensOut <= 0n) return 0n;
    if (adj > -2n && adj < 2n) break;
  }
  return tokensOut;
}

function sellQuote(tokenAmount, currentSupply, alpha, beta, tradeFeeBPS = 100) {
  if (tokenAmount <= 0n || tokenAmount > currentSupply) return 0n;
  const newSupply = currentSupply - tokenAmount;
  const rawTon = integrateCurve(newSupply, currentSupply, alpha, beta);
  return (rawTon * (10000n - BigInt(tradeFeeBPS))) / 10000n;
}

module.exports = {
  name: "groypfi-groypad",
  description:
    "Deploy, trade, and manage tokens on Groypad — a bonding-curve memecoin launchpad on TON.",
  version: "1.2.0",

  tools: [
    // ── Deploy Token ──
    {
      name: "groypad_deploy",
      description:
        "Deploy a new memecoin on Groypad. Creates a bonding curve token on the MemeFactory contract with metadata and an initial buy.",
      parameters: {
        name: {
          type: "string",
          description: "Token name (e.g. 'Pepe the Frog')",
          required: true,
        },
        ticker: {
          type: "string",
          description: "Token ticker/symbol, 2-10 chars (e.g. 'PEPE')",
          required: true,
        },
        description: {
          type: "string",
          description: "Token description (min 10 chars)",
          required: true,
        },
        initial_buy_ton: {
          type: "number",
          description: "TON for initial buy (minimum 10 TON)",
          required: true,
        },
        image_url: {
          type: "string",
          description: "Public URL to token logo image (required)",
          required: true,
        },
        website: {
          type: "string",
          description: "Project website URL",
          default: "",
        },
        telegram: {
          type: "string",
          description: "Telegram group/channel URL",
          default: "",
        },
        twitter: {
          type: "string",
          description: "X/Twitter profile URL",
          default: "",
        },
      },
      async execute(
        {
          name,
          ticker,
          description,
          initial_buy_ton,
          image_url,
          website = "",
          telegram = "",
          twitter = "",
        },
        { ton, log }
      ) {
        if (!image_url) {
          return {
            success: false,
            error: "Token logo image_url is required",
          };
        }
        if (initial_buy_ton < 10) {
          return {
            success: false,
            error: "Minimum initial buy is 10 TON",
          };
        }

        // Step 1: Upload metadata JSON to Supabase storage
        const metadata = {
          name,
          symbol: ticker,
          description,
          image: image_url,
          website,
          social: { telegram, twitter },
        };

        log.info(`Uploading metadata for ${ticker}...`);

        const metaFileName = `${Date.now()}_${ticker.toLowerCase()}.json`;
        const uploadRes = await fetch(
          `${SUPABASE_URL}/functions/v1/upload-token-asset`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bucket: "token-metadata",
              fileName: metaFileName,
              content: JSON.stringify(metadata),
            }),
          }
        );

        if (!uploadRes.ok) {
          const err = await uploadRes.text();
          return { success: false, error: "Metadata upload failed: " + err };
        }

        const { publicUrl: metadataUrl } = await uploadRes.json();
        log.info(`Metadata uploaded: ${metadataUrl}`);

        // Step 2: Build deploy transaction
        // DeployMeme opcode: 0x6ff416dc
        // Message: op(32) + queryId(64) + presetId(4) + metadata_url(ref) + initialBuy(coins)
        //          + partnerConfig(bit=0) + referrerConfig(bit=0)
        const initialBuyNano = BigInt(Math.floor(initial_buy_ton * 1e9));
        const gasAmount = 500000000n; // 0.5 TON gas

        log.info(
          `Deploying ${ticker} with ${initial_buy_ton} TON initial buy...`
        );

        const tx = await ton.send(MEME_FACTORY, Number(gasAmount + initialBuyNano) / 1e9, {
          opcode: 0x6ff416dc,
          queryId: 0,
          payload: {
            uint4: 0, // presetId
            ref: { string: metadataUrl }, // metadata URL in ref cell
            coins: initialBuyNano, // initial buy amount
            bit: false, // no partner config
            bit2: false, // no referrer config
          },
        });

        log.info(`Token deployed! TX: ${tx.hash}`);

        return {
          success: true,
          txHash: tx.hash,
          ticker,
          name,
          initialBuy: initial_buy_ton + " TON",
          metadataUrl,
          factory: MEME_FACTORY,
        };
      },
    },

    // ── List Tokens ──
    {
      name: "groypad_list_tokens",
      description:
        "List active Groypad tokens with market cap, progress, volume, and holders",
      parameters: {},
      async execute(_, { log }) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/launchpad_tokens?is_graduated=eq.false&order=market_cap.desc.nullslast&limit=50`,
          { headers: { apikey: API_KEY } }
        );
        const tokens = await res.json();
        log.info(`Found ${tokens.length} active Groypad tokens`);
        return tokens.map((t) => ({
          ticker: t.ticker,
          name: t.name,
          address: t.meme_address,
          marketCap: t.market_cap?.toFixed(2) + " TON",
          progress: (t.progress || 0).toFixed(1) + "%",
          volume24h: t.volume_24h?.toFixed(2) + " TON",
          holders: t.holders,
        }));
      },
    },

    // ── Token Info (on-chain) ──
    {
      name: "groypad_token_info",
      description:
        "Get on-chain bonding curve data for a Groypad token (price, progress, supply, raised funds)",
      parameters: {
        address: {
          type: "string",
          description: "Meme contract address",
          required: true,
        },
      },
      async execute({ address }, { ton, log }) {
        const result = await ton.runGetMethod(address, "get_meme_data", []);
        const stack = result.stack;
        const data = {
          initialized: stack[0] !== "0",
          migrated: stack[1] !== "0",
          isGraduated: stack[6] !== "0",
          alpha: BigInt(stack[7]),
          beta: BigInt(stack[8]),
          tradeFeeBPS: Number(stack[10]),
          raisedFunds: BigInt(stack[11]),
          currentSupply: BigInt(stack[12]),
        };
        const price =
          Number(data.alpha + (data.beta * data.currentSupply) / PRECISION) /
          1e9;
        const progress = Math.min(
          100,
          Number((data.raisedFunds * 10000n) / (1050n * PRECISION)) / 100
        );
        log.info(
          `Token price: ${price.toFixed(9)} TON, progress: ${progress.toFixed(1)}%`
        );
        return {
          ...data,
          price,
          progress: progress.toFixed(1) + "%",
          alpha: data.alpha.toString(),
          beta: data.beta.toString(),
          raisedFunds:
            (Number(data.raisedFunds) / 1e9).toFixed(4) + " TON",
          currentSupply: data.currentSupply.toString(),
        };
      },
    },

    // ── Buy ──
    {
      name: "groypad_buy",
      description:
        "Buy tokens on the Groypad bonding curve. Sends TON from the agent wallet.",
      parameters: {
        address: {
          type: "string",
          description: "Meme contract address",
          required: true,
        },
        amount_ton: {
          type: "number",
          description: "TON to spend",
          required: true,
        },
        slippage: {
          type: "number",
          description: "Slippage % (default 5)",
          default: 5,
        },
      },
      async execute({ address, amount_ton, slippage = 5 }, { ton, log }) {
        // Read on-chain state
        const result = await ton.runGetMethod(address, "get_meme_data", []);
        const stack = result.stack;
        const alpha = BigInt(stack[7]);
        const beta = BigInt(stack[8]);
        const supply = BigInt(stack[12]);

        const amountNano = BigInt(Math.floor(amount_ton * 1e9));
        const tokensOut = buyQuote(amountNano, supply, alpha, beta);
        const minOut = (tokensOut * BigInt(100 - slippage)) / 100n;

        log.info(
          `Buying ~${Number(tokensOut) / 1e9} tokens for ${amount_ton} TON`
        );

        // Build & send transaction
        // opcode 0x742b36d8 + queryId(0) + minTokensOut(coins)
        const tx = await ton.send(address, amount_ton + 0.3, {
          opcode: 0x742b36d8,
          queryId: 0,
          payload: { coins: minOut },
        });

        return {
          success: true,
          txHash: tx.hash,
          estimatedTokens: (Number(tokensOut) / 1e9).toFixed(2),
        };
      },
    },

    // ── Sell ──
    {
      name: "groypad_sell",
      description:
        "Sell Groypad tokens back to the bonding curve. Burns tokens from the agent wallet.",
      parameters: {
        address: {
          type: "string",
          description: "Meme contract address",
          required: true,
        },
        amount: {
          type: "string",
          description:
            "Token amount to sell (nano-tokens, bigint string). Use 'all' for full balance.",
          required: true,
        },
      },
      async execute({ address, amount }, { ton, log }) {
        const walletAddr = await ton.getMyAddress();

        // Resolve user's MemeWallet via get_wallet_address
        const walletResult = await ton.runGetMethod(
          address,
          "get_wallet_address",
          [{ type: "slice", value: walletAddr }]
        );
        const memeWallet = walletResult.stack[0];

        // Get actual on-chain balance (prevents exit_code 27 bounces)
        const balResult = await ton.runGetMethod(
          memeWallet,
          "get_wallet_data",
          []
        );
        const actualBalance = BigInt(balResult.stack[0]);

        let sellAmount =
          amount === "all" ? actualBalance : BigInt(amount);
        if (sellAmount > actualBalance) sellAmount = actualBalance;

        if (sellAmount <= 0n)
          return { success: false, error: "Zero balance" };

        log.info(
          `Selling ${Number(sellAmount) / 1e9} tokens from ${memeWallet}`
        );

        // opcode 0x595f07bc + queryId(0) + amount(coins) + responseDestination(address) + customPayload(bit=0)
        const tx = await ton.send(memeWallet, 0.3, {
          opcode: 0x595f07bc,
          queryId: 0,
          payload: { coins: sellAmount, address: walletAddr, bit: false },
        });

        return {
          success: true,
          txHash: tx.hash,
          sold: (Number(sellAmount) / 1e9).toFixed(2),
        };
      },
    },

    // ── Get Quote (preview buy/sell) ──
    {
      name: "groypad_get_quote",
      description:
        "Preview a buy or sell quote on the Groypad bonding curve without executing a trade. Returns estimated tokens out (buy) or TON out (sell).",
      parameters: {
        address: {
          type: "string",
          description: "Meme contract address",
          required: true,
        },
        side: {
          type: "string",
          description: "'buy' or 'sell'",
          required: true,
        },
        amount: {
          type: "number",
          description:
            "For buy: TON to spend. For sell: token amount (human-readable, e.g. 1000.5)",
          required: true,
        },
      },
      async execute({ address, side, amount }, { ton, log }) {
        const result = await ton.runGetMethod(address, "get_meme_data", []);
        const stack = result.stack;
        const alpha = BigInt(stack[7]);
        const beta = BigInt(stack[8]);
        const tradeFeeBPS = Number(stack[10]);
        const supply = BigInt(stack[12]);

        const currentPrice =
          Number(alpha + (beta * supply) / PRECISION) / 1e9;

        if (side === "buy") {
          const amountNano = BigInt(Math.floor(amount * 1e9));
          const tokensOut = buyQuote(amountNano, supply, alpha, beta);
          const cost = integrateCurve(supply, supply + tokensOut, alpha, beta);
          const avgPrice = tokensOut > 0n ? Number(cost) / Number(tokensOut) : 0;
          const priceAfter =
            Number(alpha + (beta * (supply + tokensOut)) / PRECISION) / 1e9;
          const priceImpact =
            currentPrice > 0
              ? (((priceAfter - currentPrice) / currentPrice) * 100).toFixed(2)
              : "0";

          log.info(
            `Buy quote: ${amount} TON → ~${(Number(tokensOut) / 1e9).toFixed(2)} tokens (impact: ${priceImpact}%)`
          );

          return {
            side: "buy",
            inputTon: amount,
            estimatedTokensOut: (Number(tokensOut) / 1e9).toFixed(4),
            avgPricePerToken: avgPrice.toFixed(9) + " TON",
            currentPrice: currentPrice.toFixed(9) + " TON",
            priceAfter: priceAfter.toFixed(9) + " TON",
            priceImpact: priceImpact + "%",
          };
        } else if (side === "sell") {
          const tokenNano = BigInt(Math.floor(amount * 1e9));
          const tonOut = sellQuote(tokenNano, supply, alpha, beta, tradeFeeBPS);
          const newSupply = supply - tokenNano;
          const priceAfter =
            newSupply > 0n
              ? Number(alpha + (beta * newSupply) / PRECISION) / 1e9
              : 0;
          const priceImpact =
            currentPrice > 0
              ? (((priceAfter - currentPrice) / currentPrice) * 100).toFixed(2)
              : "0";

          log.info(
            `Sell quote: ${amount} tokens → ~${(Number(tonOut) / 1e9).toFixed(4)} TON (impact: ${priceImpact}%)`
          );

          return {
            side: "sell",
            inputTokens: amount,
            estimatedTonOut: (Number(tonOut) / 1e9).toFixed(4) + " TON",
            currentPrice: currentPrice.toFixed(9) + " TON",
            priceAfter: priceAfter.toFixed(9) + " TON",
            priceImpact: priceImpact + "%",
            tradeFee: tradeFeeBPS / 100 + "%",
          };
        } else {
          return { success: false, error: "side must be 'buy' or 'sell'" };
        }
      },
    },

    // ── Claim Creator Fee ──
    {
      name: "groypad_claim_fee",
      description:
        "Claim accumulated creator trading fees from a token you deployed on Groypad.",
      parameters: {
        address: {
          type: "string",
          description: "Meme contract address",
          required: true,
        },
      },
      async execute({ address }, { ton, log }) {
        const walletAddr = await ton.getMyAddress();

        // Check claimable amount from get_meme_data stack[4]
        const result = await ton.runGetMethod(address, "get_meme_data", []);
        const creatorFee = BigInt(result.stack[4]);
        if (creatorFee <= 0n) {
          return {
            success: false,
            error: "No fees to claim",
            claimable: "0 TON",
          };
        }

        log.info(
          `Claiming ${Number(creatorFee) / 1e9} TON in creator fees`
        );

        // opcode 0xad7269a8 + queryId(0) + to(address) + excessesTo(address)
        const tx = await ton.send(address, 0.3, {
          opcode: 0xad7269a8,
          queryId: 0,
          payload: { address: walletAddr, address2: walletAddr },
        });

        return {
          success: true,
          txHash: tx.hash,
          claimed: (Number(creatorFee) / 1e9).toFixed(4) + " TON",
        };
      },
    },
  ],
};
```

# perps-mcp

This section documents GroypFi Perps MCP behavior and Teleton tool bindings.

## `plugins/groypfi-perps.js`

```javascript
// plugins/groypfi-perps.js — Teleton plugin for GroypFi Perpetuals
// Repository: https://github.com/TONresistor/teleton-agent
//
// GroypFi Perps is powered by Storm Trade on TON.
// Supports 50+ markets (crypto, forex, commodities) with up to 100x leverage.
// Collaterals: TON (9 dec), USDT (6 dec), NOT (9 dec)
// House fee: 1% of margin (TON collateral only)
//
// Docs: https://groypfi.io/docs/groypad#perps-mcp

const EDGE_BASE = "https://rcuesqclhdghrqrmwjlk.supabase.co/functions/v1";
const STORM_API = "https://api.taragodsnode.xyz/api";
const API_KEY = "<YOUR_SUPABASE_ANON_KEY>";

const headers = (extra = {}) => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${API_KEY}`,
  ...extra,
});

// Helper: call edge function
async function edgePost(fn, body) {
  const res = await fetch(`${EDGE_BASE}/${fn}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  return res.json();
}

// Helper: wait & confirm order
async function waitForConfirmation(
  walletAddress,
  uniqueId,
  txBoc,
  maxAttempts = 5
) {
  await new Promise((r) => setTimeout(r, 5000)); // initial wait
  for (let i = 0; i < maxAttempts; i++) {
    const result = await edgePost("confirm-perps-order", {
      walletAddress,
      uniqueId,
      txBoc,
    });
    if (result.status === "confirmed")
      return { confirmed: true, txHash: result.txHash };
    if (result.status === "failed")
      return { confirmed: false, error: "Transaction failed on-chain" };
    await new Promise((r) => setTimeout(r, 15000));
  }
  return { confirmed: false, error: "Confirmation timeout" };
}

module.exports = {
  name: "groypfi-perps",
  description:
    "Trade perpetual futures on GroypFi Perps (Storm Trade on TON) — open, close, TP/SL, cancel, oracle prices",
  version: "2.0.0",

  tools: [
    // ── Oracle Price ──
    {
      name: "perps_oracle_price",
      description: "Get current oracle price for a perps asset",
      parameters: {
        asset: {
          type: "string",
          description: "Asset symbol e.g. BTC, ETH, TON",
          required: true,
        },
      },
      async execute({ asset }, { log }) {
        const data = await edgePost("perps-oracle", {
          baseAssetName: asset.toUpperCase(),
        });
        if (!data.success) return { error: data.error };
        log.info(`${asset} oracle: $${data.oraclePrice}`);
        return {
          asset,
          price: data.oraclePrice,
          timestamp: data.timestamp,
        };
      },
    },

    // ── List Markets ──
    {
      name: "perps_list_markets",
      description:
        "List all available perps markets with prices and leverage limits",
      parameters: {},
      async execute(_, { log }) {
        const res = await fetch(`${STORM_API}/markets`);
        const data = await res.json();
        const markets = (data.data || data)
          .filter((m) => {
            const tags = m.config?.tags || [];
            return tags.includes("Crypto") && !m.settings?.isCloseOnly;
          })
          .map((m) => ({
            asset: m.config?.baseAsset || m.baseAsset,
            maxLeverage: Math.round(
              (m.settings?.maxLeverage || 50e9) / 1e9
            ),
            indexPrice: (
              parseFloat(m.amm?.indexPrice || "0") / 1e9
            ).toFixed(2),
            volume24h: (
              parseFloat(m.change?.quoteVolume || "0") / 1e9
            ).toFixed(0),
          }));
        log.info(`Found ${markets.length} active perps markets`);
        return markets;
      },
    },

    // ── Get Positions ──
    {
      name: "perps_get_positions",
      description: "Get all open perpetual positions for a wallet",
      parameters: {
        wallet_address: { type: "string", required: true },
      },
      async execute({ wallet_address }, { log }) {
        const res = await fetch(
          `${STORM_API}/positions/${encodeURIComponent(wallet_address)}`
        );
        if (!res.ok) return [];
        const positions = await res.json();
        const arr = Array.isArray(positions)
          ? positions
          : positions.data || [];
        log.info(`Found ${arr.length} open positions`);
        return arr.map((p) => ({
          asset: p.asset,
          direction: p.direction,
          size: p.sizeCrypto,
          sizeRaw:
            p.sizeRaw ||
            String(Math.floor(parseFloat(p.sizeCrypto || "0") * 1e9)),
          notional: p.size,
          entryPrice: p.entryPrice,
          markPrice: p.markPrice,
          leverage: p.leverage,
          margin: p.margin,
          pnl: p.pnl,
          liquidationPrice: p.liquidationPrice,
          collateral: p.collateralAsset || "TON",
        }));
      },
    },

    // ── Open Position ──
    {
      name: "perps_open_position",
      description:
        "Open a leveraged long or short position. Returns tx to sign & sends it.",
      parameters: {
        pair: {
          type: "string",
          required: true,
          description: "Asset e.g. BTC",
        },
        direction: {
          type: "string",
          required: true,
          description: "long or short",
        },
        margin: {
          type: "number",
          required: true,
          description: "Collateral amount",
        },
        leverage: { type: "number", default: 5 },
        collateral: { type: "string", default: "TON" },
        order_type: { type: "string", default: "market" },
        limit_price: {
          type: "number",
          description: "For limit orders",
        },
        stop_loss: { type: "number", description: "SL price USD" },
        take_profit: { type: "number", description: "TP price USD" },
      },
      async execute(
        {
          pair,
          direction,
          margin,
          leverage = 5,
          collateral = "TON",
          order_type = "market",
          limit_price,
          stop_loss,
          take_profit,
        },
        { ton, log }
      ) {
        const walletAddr = await ton.getMyAddress();
        const size = margin * leverage;
        log.info(
          `Opening ${direction} ${pair} — ${margin} ${collateral} × ${leverage}x = $${size}`
        );

        // 1. Build transaction via edge function
        const orderRes = await edgePost("perps-order", {
          action: "create",
          traderAddress: walletAddr,
          baseAssetName: pair.toUpperCase(),
          collateralAssetName: collateral,
          direction,
          amount: margin,
          leverage,
          orderType: order_type,
          limitPrice: limit_price,
          stopLossPrice: stop_loss,
          takeProfitPrice: take_profit,
        });

        if (!orderRes.success)
          return { success: false, error: orderRes.error };

        // 2. Sign & send
        const tx = await ton.sendRaw(orderRes.transaction);
        log.info(`TX sent: ${tx.hash}`);

        // 3. Track pending order
        const uniqueId = `teleton_${Date.now()}`;
        await edgePost("track-perps-order", {
          wallet_address: walletAddr,
          pair: `${pair}/USD`,
          direction,
          collateral,
          order_type,
          leverage,
          margin,
          size,
          oracle_price_at_submit:
            orderRes.orderDetails?.sdkOraclePrice,
          unique_id: uniqueId,
          submitted_at: Math.floor(Date.now() / 1000),
          tx_boc: tx.boc,
          limit_price: limit_price || null,
        });

        // 4. Wait for confirmation
        const confirmation = await waitForConfirmation(
          walletAddr,
          uniqueId,
          tx.boc
        );
        log.info(`Confirmation: ${JSON.stringify(confirmation)}`);

        return {
          success: true,
          txHash: confirmation.txHash || tx.hash,
          confirmed: confirmation.confirmed,
          pair,
          direction,
          size,
          leverage,
          margin,
          collateral,
        };
      },
    },

    // ── Close Position ──
    {
      name: "perps_close_position",
      description: "Close an open perpetual position",
      parameters: {
        pair: { type: "string", required: true },
        direction: { type: "string", required: true },
        collateral: { type: "string", default: "TON" },
      },
      async execute(
        { pair, direction, collateral = "TON" },
        { ton, log }
      ) {
        const walletAddr = await ton.getMyAddress();
        log.info(`Closing ${direction} ${pair}`);

        // 1. Fetch close fields (source of truth for size)
        const closeFields = await fetch(
          `${STORM_API}/close/fields?walletAddress=${encodeURIComponent(walletAddr)}&asset=${pair}&collateral=${collateral}&side=${direction}`
        ).then((r) => r.json());

        if (closeFields.status !== "OPEN")
          return { success: false, error: "No open position found" };

        // 2. Build close tx
        const orderRes = await edgePost("perps-order", {
          action: "close",
          traderAddress: walletAddr,
          baseAssetName: closeFields.baseAssetName,
          collateralAssetName: closeFields.collateralAssetName,
          direction: closeFields.direction,
          size: closeFields.size, // Raw 9-decimal string — DO NOT convert
        });

        if (!orderRes.success)
          return { success: false, error: orderRes.error };

        // 3. Send tx
        const tx = await ton.sendRaw(orderRes.transaction);
        log.info(`Close TX sent: ${tx.hash}`);
        return {
          success: true,
          txHash: tx.hash,
          pair,
          direction,
          action: "close",
        };
      },
    },

    // ── Set TP/SL ──
    {
      name: "perps_set_tp_sl",
      description:
        "Set take-profit or stop-loss on an existing position",
      parameters: {
        pair: { type: "string", required: true },
        direction: { type: "string", required: true },
        collateral: { type: "string", default: "TON" },
        tp_price: {
          type: "number",
          description: "Take profit price USD",
        },
        sl_price: {
          type: "number",
          description: "Stop loss price USD",
        },
      },
      async execute(
        { pair, direction, collateral = "TON", tp_price, sl_price },
        { ton, log }
      ) {
        const walletAddr = await ton.getMyAddress();

        // Get position size
        const closeFields = await fetch(
          `${STORM_API}/close/fields?walletAddress=${encodeURIComponent(walletAddr)}&asset=${pair}&collateral=${collateral}&side=${direction}`
        ).then((r) => r.json());

        if (closeFields.status !== "OPEN")
          return { success: false, error: "No open position" };

        const results = {};

        if (tp_price) {
          const res = await edgePost("perps-order", {
            action: "take-profit",
            traderAddress: walletAddr,
            baseAssetName: pair,
            collateralAssetName: collateral,
            direction,
            size: closeFields.size,
            takeProfitPrice: tp_price,
          });
          if (res.success) {
            const tx = await ton.sendRaw(res.transaction);
            results.takeProfit = {
              success: true,
              txHash: tx.hash,
              price: tp_price,
            };
            log.info(`TP set at $${tp_price}`);
          } else {
            results.takeProfit = { success: false, error: res.error };
          }
        }

        if (sl_price) {
          const res = await edgePost("perps-order", {
            action: "stop-loss",
            traderAddress: walletAddr,
            baseAssetName: pair,
            collateralAssetName: collateral,
            direction,
            size: closeFields.size,
            stopLossPrice: sl_price,
          });
          if (res.success) {
            const tx = await ton.sendRaw(res.transaction);
            results.stopLoss = {
              success: true,
              txHash: tx.hash,
              price: sl_price,
            };
            log.info(`SL set at $${sl_price}`);
          } else {
            results.stopLoss = { success: false, error: res.error };
          }
        }

        return results;
      },
    },

    // ── Cancel Limit Order ──
    {
      name: "perps_cancel_order",
      description: "Cancel a pending limit order by its order index",
      parameters: {
        pair: { type: "string", required: true },
        direction: { type: "string", required: true },
        collateral: { type: "string", default: "TON" },
        order_index: {
          type: "number",
          required: true,
          description: "From pending orders API",
        },
      },
      async execute(
        { pair, direction, collateral = "TON", order_index },
        { ton, log }
      ) {
        const walletAddr = await ton.getMyAddress();
        log.info(`Cancelling limit order #${order_index} for ${pair}`);

        const res = await edgePost("perps-order", {
          action: "cancel",
          traderAddress: walletAddr,
          baseAssetName: pair,
          collateralAssetName: collateral,
          direction,
          orderIndex: order_index,
        });

        if (!res.success)
          return { success: false, error: res.error };

        const tx = await ton.sendRaw(res.transaction);
        log.info(`Cancel TX: ${tx.hash}`);
        return {
          success: true,
          txHash: tx.hash,
          orderIndex: order_index,
        };
      },
    },
  ],
};
```

# mcp-plugin

This section provides MCP-oriented setup guidance for the GroypFi integration and links.

## GroypFi Plugins for Teleton Agent

Enable AI agents to trade tokens on **Groypad** (bonding-curve launchpad) and **GroypFi Perps** (leveraged perpetuals) — all on **TON**.

- Website: https://groypfi.io
- Docs: https://groypfi.io/docs/groypad
- Telegram Bot: https://t.me/groypfi_bot
- DefiLlama: https://defillama.com/protocol/fees/groypfi

### Quick Start

1. Copy `groypfi-groypad.js` and `groypfi-perps.js` into your Teleton `plugins/` directory.
2. Set your API key in both files.
3. Restart Teleton.

### Configuration

Use either:

```javascript
// Option 1: Teleton secret manager (recommended)
const API_KEY = secrets.get("GROYPAD_API_KEY");

// Option 2: Inline
const API_KEY = "<YOUR_SUPABASE_ANON_KEY>";
```

### Endpoints

- Supabase REST: `https://rcuesqclhdghrqrmwjlk.supabase.co`
- Edge Functions: `https://rcuesqclhdghrqrmwjlk.supabase.co/functions/v1`
- Storm API: `https://api.taragodsnode.xyz/api`

### Contract Reference

- MemeFactory: `EQAO4cYqithwdltzmrlal1L5JKLK5Xk76feAJq0VoBC6Fy8T`
- Deploy opcode: `0x6ff416dc`
- Buy opcode: `0x742b36d8`
- Sell opcode: `0x595f07bc`
- Claim fee opcode: `0xad7269a8`
- Graduation target: `1,050 TON`
- Minimum initial buy: `10 TON`

### Perps Order Flow

```text
Agent (Teleton)
  │
  ├─ perps-oracle   → Edge Function → Storm API → Oracle price
  ├─ perps-order    → Edge Function → Storm SDK → Transaction BOC
  │                                                    │
  │                         Agent signs & sends ◄──────┘
  │                                │
  └─ confirm-perps-order → Edge Function → TON API → Confirmation
```

All heavy lifting (Storm SDK, transaction building) is handled server-side by Edge Functions. Plugins only need `fetch` and Teleton's built-in `ton` context.

### License

MIT (GroypFi plugin package)
