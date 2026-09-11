# TON Wallet Guide

This guide covers setting up and using the TON blockchain wallet integrated into Teleton Agent, including the wallet lifecycle, the `sdk.ton` plugin surface, payment verification, and security practices.

---

## Table of Contents

- [Wallet Overview](#wallet-overview)
- [Wallet Generation](#wallet-generation)
- [Importing an Existing Wallet](#importing-an-existing-wallet)
- [Funding Your Wallet](#funding-your-wallet)
- [Wallet Address](#wallet-address)
- [SDK Access for Plugins](#sdk-access-for-plugins)
- [Signed Transfers (x402)](#signed-transfers-x402)
- [Payment Verification](#payment-verification)
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

After generating or importing a wallet, you need to fund it before it can send transactions.

### Find Your Wallet Address

The agent's wallet address is available through:
- The WebUI dashboard (if enabled)
- The `wallet.json` file directly
- `sdk.ton.getAddress()` from a plugin

### Send TON to Your Wallet

Transfer TON from any wallet or exchange to the agent's address. The minimum amount needed to activate the wallet and cover transaction fees is approximately **0.05 TON**.

For meaningful operations:
- **Simple transfers**: 0.1 TON is sufficient for dozens of transfers
- **DEX trading**: 1+ TON recommended (to cover gas fees on swaps)
- **NFT operations**: 0.5+ TON recommended

### Verify the Deposit

Ask the agent to check its balance, or read it via `sdk.ton.getBalance()`. The balance is fetched from the TON blockchain via decentralized endpoints (Orbs Network) with no rate limits.

---

## Wallet Address

The wallet address is a static property of the W5R1 wallet contract. It is derived from the public key and never changes. Addresses are validated with `Address.parse()` from `@ton/core` before any on-chain interaction.

---

## SDK Access for Plugins

Plugins access the TON wallet through the frozen SDK:

| Method | Description |
|--------|-------------|
| `sdk.ton.getAddress()` | Read the wallet address |
| `sdk.ton.getBalance()` | Check the TON balance |
| `sdk.ton.sendTON(to, amount, comment?)` | Send TON |
| `sdk.ton.sendJetton(jetton, to, amount, opts?)` | Send jettons |
| `sdk.ton.verifyPayment(txHash, expectedAmount?)` | Verify an incoming payment |

Jetton and DEX helper methods:

| Method | Description |
|--------|-------------|
| `getJettonBalances(owner?)` | List jetton balances |
| `getJettonInfo(address)` | Get jetton metadata |
| `createJettonTransfer(jettonAddress, to, amount, opts?)` | Sign a jetton transfer without broadcasting |
| `getJettonPrice(jettonAddress)` | USD/TON price with 24h/7d/30d changes |
| `getJettonHolders(jettonAddress, limit?)` | Top holders ranked by balance (max 100) |
| `getJettonHistory(jettonAddress)` | Volume, FDV, market cap, holder count |

Plugins cannot:
- Access the mnemonic or private keys
- Modify the wallet file
- Bypass address validation
- Access the raw `@ton/ton` client

---

## Signed Transfers (x402)

The SDK supports signing transfers without broadcasting them, useful for the x402 payment protocol and other pre-signed transaction workflows:

- `sdk.ton.createTransfer(to, amount, comment?)` -- returns a `SignedTransfer` with the signed BOC
- `sdk.ton.createJettonTransfer(jettonAddress, to, amount, opts?)` -- same for jetton transfers

These methods produce a ready-to-broadcast transaction that can be submitted later by a third party.

---

## Payment Verification

The `sdk.ton.verifyPayment()` method includes replay protection: each transaction hash is stored in the plugin's database and cannot be used twice. This prevents double-spend attacks in payment-based plugins (e.g., casino games).

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

Plugins access the wallet through the frozen SDK and cannot access the mnemonic, private keys, the wallet file, or the raw `@ton/ton` client.

---

## TonAPI Key

For higher rate limits on blockchain queries, obtain a TonAPI key:

1. Open [@tonapi_bot](https://t.me/tonapi_bot) on Telegram
2. Follow the prompts to generate an API key
3. Add it to your config:

```yaml
tonapi_key: "AF..."
```

Without a TonAPI key, the agent uses public endpoints with standard rate limits. The key is used for on-chain data queries and is never exposed to plugins (it is stripped from the sanitized config).