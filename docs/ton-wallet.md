# TON Wallet Guide

This guide covers setting up and using the TON blockchain wallet integrated into Teleton Agent, including sending and receiving TON, managing jettons, DEX trading, NFTs, and DNS operations.

---

## Table of Contents

- [Wallet Overview](#wallet-overview)
- [Wallet Generation](#wallet-generation)
- [Importing an Existing Wallet](#importing-an-existing-wallet)
- [Funding Your Wallet](#funding-your-wallet)
- [Checking Balance](#checking-balance)
- [Sending TON](#sending-ton)
- [Jetton Operations](#jetton-operations)
- [DEX Trading](#dex-trading)
  - [STON.fi](#stonfi)
  - [DeDust](#dedust)
- [NFT Management](#nft-management)
- [DNS Integration](#dns-integration)
- [Security Considerations](#security-considerations)
- [TonAPI Key](#tonapi-key)

---

## Wallet Overview

Teleton Agent uses a **W5R1** (Wallet V5 Revision 1) contract on the TON blockchain. This is the most modern wallet version, supporting advanced features like gas-optimized transfers.

The wallet data is stored at `~/.teleton/wallet.json` with restricted file permissions (`0600` -- owner read/write only). The file contains:

- **24-word mnemonic seed phrase** -- the master key to the wallet
- **Public key** -- derived from the mnemonic
- **Address** -- the bounceable, non-testnet wallet address
- **Version** -- always `"w5r1"`

The agent caches the derived key pair in memory after first use, avoiding repeated PBKDF2 key derivation (which is computationally expensive).

---

## Wallet Generation

The setup wizard (`teleton setup`) includes wallet generation as part of the initial configuration. You can also manage wallets separately.

### Via Setup Wizard

```bash
teleton setup
```

The wizard will ask if you want to generate a new wallet or import an existing one. If you generate a new wallet, the 24-word mnemonic is displayed once. **Write it down and store it securely.** It cannot be recovered if lost.

### Programmatic (for Plugins)

Plugins can access the wallet through `sdk.ton.getAddress()` but cannot generate new wallets. Wallet generation is a platform-level operation.

### What Happens During Generation

1. A new 24-word BIP39-compatible mnemonic is generated using `@ton/crypto`
2. A key pair is derived from the mnemonic via PBKDF2
3. A W5R1 wallet contract is created with the public key
4. The bounceable address is computed
5. Everything is saved to `~/.teleton/wallet.json` with `0600` permissions

---

## Importing an Existing Wallet

If you already have a TON wallet, you can import it using the 24-word mnemonic seed phrase during the setup process. The platform validates the mnemonic before accepting it:

- The mnemonic must be exactly 24 words
- It must pass `mnemonicValidate()` from `@ton/crypto`
- A W5R1 wallet is derived from the mnemonic (this may differ from your original wallet version, meaning the address will be different)

Note: If your original wallet uses a different contract version (V3R2, V4R2, etc.), the derived address will be different from your original. Your funds remain accessible at the original address, but the agent will use the new W5R1 address. Transfer your funds to the new address if needed.

---

## Funding Your Wallet

After generating or importing a wallet, you need to fund it before you can send transactions.

### Find Your Wallet Address

The agent's wallet address is available through:
- The `ton_balance` tool (ask the agent: "What is my wallet address?")
- The WebUI dashboard (if enabled)
- The `wallet.json` file directly

### Send TON to Your Wallet

Transfer TON from any wallet or exchange to the agent's address. The minimum amount needed to activate the wallet and cover transaction fees is approximately **0.05 TON**.

For meaningful operations:
- **Simple transfers**: 0.1 TON is sufficient for dozens of transfers
- **DEX trading**: 1+ TON recommended (to cover gas fees on swaps)
- **NFT operations**: 0.5+ TON recommended

### Verify the Deposit

Ask the agent to check its balance, or use the `ton_balance` tool. The balance is fetched from the TON blockchain via decentralized endpoints (Orbs Network) with no rate limits.

---

## Checking Balance

The agent provides several built-in tools for balance checking:

### TON Balance

The `ton_balance` tool queries the blockchain for the current TON balance. Results include:
- **balance**: Human-readable format (e.g., `"12.50"`)
- **balanceNano**: Raw nanoTON format (e.g., `"12500000000"`)

### TON Price

The `ton_price` tool fetches the current TON/USD price. It uses TonAPI as the primary source with CoinGecko as a fallback. Results are cached for 30 seconds to reduce API calls.

### Jetton Balances

The `ton_jetton_balances` tool lists all jetton (token) balances held by the wallet. Results include:
- Token name, symbol, and address
- Balance in human-readable and raw formats
- USD price (when available)
- Verification status (whitelisted/unknown)

Blacklisted jettons are automatically filtered out.

---

## Sending TON

The agent can send TON to any valid address using the `ton_send` tool.

### How It Works

1. The recipient address is validated using `Address.parse()` from `@ton/core`
2. The cached key pair is retrieved (or derived from the mnemonic on first use)
3. A W5R1 wallet contract is created with the public key
4. The current sequence number (seqno) is fetched from the blockchain
5. A transfer message is constructed with the specified amount and optional comment
6. The transaction is broadcast using `SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS`

### Transaction Reference

After sending, the tool returns a pseudo-hash in the format `seqno_timestamp_amount` (e.g., `42_1708123456789_1.50`). This is not the actual blockchain hash but serves as a reference until the transaction is confirmed on-chain.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `toAddress` | `string` | Yes | Recipient's TON address |
| `amount` | `number` | Yes | Amount in TON (e.g., `1.5`) |
| `comment` | `string` | No | Transaction memo/comment |

### Gas Fees

TON transfer fees are extremely low (typically 0.005-0.01 TON). Gas is paid separately from the transfer amount.

---

## Jetton Operations

Jettons are fungible tokens on the TON blockchain (similar to ERC-20 tokens on Ethereum).

### Viewing Jettons

The `ton_jetton_balances` tool lists all jettons held by a wallet. Each entry includes:
- Jetton contract address
- Jetton wallet address (the user's jetton wallet, different from the jetton itself)
- Balance with proper decimal handling
- Symbol, name, and verification status

### Sending Jettons

The agent can send jettons using the `ton_jetton_send` tool. The process:

1. Validates the recipient address
2. Looks up the sender's jetton wallet address via TonAPI
3. Checks sufficient balance
4. Constructs a TEP-74 compliant transfer message
5. Sends via the W5R1 wallet contract

The gas fee for jetton transfers is approximately 0.05 TON (sent alongside the transfer message for contract execution).

### Jetton Information

The `ton_jetton_info` tool fetches metadata about any jetton by its contract address, including:
- Name, symbol, and decimals
- Total supply and holder count
- Verification status
- Description and image

---

## DEX Trading

Teleton Agent integrates with two major TON decentralized exchanges. Each DEX has 5 tools.

### STON.fi

[STON.fi](https://ston.fi) is the largest DEX on TON.

**Available tools:**

| Tool | Description |
|------|-------------|
| `stonfi_search` | Search for tokens by name or symbol |
| `stonfi_quote` | Get a swap quote (estimated output, price impact, fees) |
| `stonfi_swap` | Execute a token swap |
| `stonfi_pools` | List available liquidity pools |
| `stonfi_trending` | View trending tokens and pairs |

**Swap flow:**
1. Search for the token you want to trade
2. Get a quote to see the expected output and price impact
3. If acceptable, execute the swap

The agent automatically handles decimal conversion by fetching token metadata from the STON.fi API.

### DeDust

[DeDust](https://dedust.io) is another major TON DEX.

**Available tools:**

| Tool | Description |
|------|-------------|
| `dedust_quote` | Get a swap quote |
| `dedust_swap` | Execute a token swap |
| `dedust_pools` | List liquidity pools with TVL |
| `dedust_prices` | Get token prices from DeDust |
| `dedust_token_info` | Get detailed token information |

### Trading Tips

- Always check the quote before executing a swap to review price impact and slippage
- DEX swaps require gas (approximately 0.25-0.5 TON for swap execution)
- Price impact increases with larger trade sizes relative to pool liquidity
- The `dex_quote` tool can compare quotes across both exchanges

---

## NFT Management

The agent can interact with NFTs on the TON blockchain.

### Viewing NFTs

The `ton_nft_items` tool lists all NFTs owned by a wallet. Results include:
- NFT address and collection info
- Name, description, and preview image
- Verification/trust status

Blacklisted NFTs are automatically filtered out. The tool supports indirect ownership (NFTs in smart contracts that are owned by the wallet).

### NFT Information

The `ton_nft_info` tool provides detailed information about a specific NFT by its address.

### NFT Listing

The `ton_nft_list` tool allows listing NFTs for sale on supported marketplaces.

---

## DNS Integration

TON DNS allows mapping human-readable `.ton` domains to wallet addresses and other resources. Teleton Agent includes 7 DNS tools.

| Tool | Description |
|------|-------------|
| `dns_check` | Check availability of a `.ton` domain |
| `dns_resolve` | Resolve a `.ton` domain to its wallet address |
| `dns_link` | Link a `.ton` domain to a wallet address |
| `dns_unlink` | Remove a domain-to-address link |
| `dns_auctions` | View active domain auctions |
| `dns_start_auction` | Start an auction for an available domain |
| `dns_bid` | Place a bid on a domain auction |

### Domain Resolution

```
User: "Resolve alice.ton"
Agent: [uses dns_resolve] alice.ton resolves to EQB...xyz
```

### Domain Auctions

Short `.ton` domains (4 characters or fewer) go through an auction process. Longer domains can be registered directly. The auction tools allow you to browse active auctions, start new ones, and place bids.

---

## Security Considerations

### Wallet File Protection

The `wallet.json` file contains the mnemonic seed phrase -- effectively the private key to the wallet. Protect it:

- **File permissions**: The platform sets `0600` (owner read/write only) automatically
- **Backups**: Back up `~/.teleton/wallet.json` securely. If lost, the wallet is unrecoverable
- **Never share**: Do not commit this file to version control or share it
- **Encryption at rest**: Consider full-disk encryption on the server

### Key Pair Caching

The key pair is derived from the mnemonic using PBKDF2 (computationally expensive by design). The agent caches the derived key pair in memory after first use to avoid repeated derivation. The cache is invalidated when the wallet file is re-saved.

### Transaction Safety

- `bounce: false` is used for TON transfers by default (safe for uninitiated wallets)
- `SendMode.PAY_GAS_SEPARATELY` ensures gas does not come from the transfer amount
- `SendMode.IGNORE_ERRORS` prevents the entire transaction from failing if a single message in a batch fails
- All addresses are validated with `Address.parse()` before sending
- Amount validation rejects non-finite and non-positive numbers

### Plugin Isolation

Plugins access the wallet through the frozen SDK. They can:
- Read the wallet address (`sdk.ton.getAddress()`)
- Check balances (`sdk.ton.getBalance()`)
- Send TON and jettons (`sdk.ton.sendTON()`, `sdk.ton.sendJetton()`)
- Verify payments (`sdk.ton.verifyPayment()`)

Plugins cannot:
- Access the mnemonic or private keys
- Modify the wallet file
- Bypass address validation
- Access the raw `@ton/ton` client

### Payment Verification

The `verifyPayment` SDK method includes replay protection: each transaction hash is stored in the plugin's database and cannot be used twice. This prevents double-spend attacks in payment-based plugins (e.g., casino games).

---

## TonAPI Key

For higher rate limits on blockchain queries, obtain a TonAPI key:

1. Open [@tonapi_bot](https://t.me/tonapi_bot) on Telegram
2. Follow the prompts to generate an API key
3. Add it to your config:

```yaml
tonapi_key: "AF..."
```

Without a TonAPI key, the agent uses public endpoints with standard rate limits. The key is used for:
- Jetton balance queries
- NFT listings
- Transaction history
- Token price lookups
- DNS operations

The key is never exposed to plugins (it is stripped from the sanitized config).
