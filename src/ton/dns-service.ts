import { Address, beginCell, type Cell } from "@ton/core";
import { internal, toNano } from "@ton/ton";
import { tonapiFetch } from "../constants/api-endpoints.js";
import { withTxLock } from "./tx-lock.js";
import { sendWalletTx, type SentTx } from "./confirm.js";
import { getCachedTonClient, loadWallet } from "./wallet-service.js";
import { openWallet } from "./wallet-open.js";

const CHANGE_DNS_RECORD_OP = 0x4eb1f0f9;
const DNS_SMC_ADDRESS_PREFIX = 0x9fd3;
const DNS_ADNL_ADDRESS_PREFIX = 0xad01;

const WALLET_RECORD_KEY = BigInt(
  "0xe8d44050873dba865aa7c170ab4cce64d90839a34dcfd6cf71d14e0205443b1b"
);
const SITE_RECORD_KEY = BigInt(
  "0xfbae041b02c41ed0fd8a4efb039bc780dd6af4a1f0c420f42561ae705dda43fe"
);

export type DnsUpdateErrorCode =
  | "INVALID_DOMAIN"
  | "INVALID_ADDRESS"
  | "INVALID_ADNL_ADDRESS"
  | "WALLET_NOT_INITIALIZED"
  | "DOMAIN_NOT_FOUND"
  | "TONAPI_ERROR"
  | "NFT_ADDRESS_MISSING"
  | "OWNER_MISSING"
  | "OWNER_INVALID"
  | "NOT_OWNER"
  | "WALLET_DERIVATION_FAILED"
  | "TRANSACTION_FAILED";

export class DnsUpdateError extends Error {
  constructor(
    message: string,
    readonly code: DnsUpdateErrorCode
  ) {
    super(message);
    this.name = "DnsUpdateError";
  }
}

interface TonApiDnsInfo {
  item?: {
    address?: string;
    owner?: { address?: string };
  };
}

export interface DnsUpdateResult {
  domain: string;
  nftAddress: string;
  from: string;
  tx: SentTx;
}

export function normalizeTonDomain(domain: string): string {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/\.ton$/, "");
  if (!normalized) {
    throw new DnsUpdateError("Domain must not be empty.", "INVALID_DOMAIN");
  }
  return `${normalized}.ton`;
}

export function normalizeAdnlAddress(address: string): string {
  const normalized = address.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new DnsUpdateError(
      "Invalid ADNL address: must be exactly 64 hex characters (256-bit).",
      "INVALID_ADNL_ADDRESS"
    );
  }
  return normalized;
}

function walletRecord(address: string): Cell {
  let parsedAddress: Address;
  try {
    parsedAddress = Address.parse(address);
  } catch {
    throw new DnsUpdateError(`Invalid wallet address: ${address}`, "INVALID_ADDRESS");
  }

  return beginCell()
    .storeUint(DNS_SMC_ADDRESS_PREFIX, 16)
    .storeAddress(parsedAddress)
    .storeUint(0, 8)
    .endCell();
}

function siteRecord(address: string): Cell {
  const normalized = normalizeAdnlAddress(address);
  return beginCell()
    .storeUint(DNS_ADNL_ADDRESS_PREFIX, 16)
    .storeBuffer(Buffer.from(normalized, "hex"), 32)
    .storeUint(0, 8)
    .endCell();
}

async function getOwnedDomain(domain: string): Promise<{
  domain: string;
  nftAddress: string;
  walletAddress: string;
}> {
  const normalized = normalizeTonDomain(domain);
  const walletData = loadWallet();
  if (!walletData) {
    throw new DnsUpdateError(
      "Wallet not initialized. Contact admin to generate wallet.",
      "WALLET_NOT_INITIALIZED"
    );
  }

  const response = await tonapiFetch(`/dns/${encodeURIComponent(normalized)}`);
  if (response.status === 404) {
    throw new DnsUpdateError(
      `Domain ${normalized} does not exist or is not minted yet.`,
      "DOMAIN_NOT_FOUND"
    );
  }
  if (!response.ok) {
    throw new DnsUpdateError(`TonAPI error: ${response.status}`, "TONAPI_ERROR");
  }

  const info = (await response.json()) as TonApiDnsInfo;
  const nftAddress = info.item?.address;
  if (!nftAddress) {
    throw new DnsUpdateError(
      `Could not determine NFT address for ${normalized}`,
      "NFT_ADDRESS_MISSING"
    );
  }

  const ownerAddress = info.item?.owner?.address;
  if (!ownerAddress) {
    throw new DnsUpdateError(
      `Domain ${normalized} has no owner (still in auction?)`,
      "OWNER_MISSING"
    );
  }

  let owner: Address;
  let wallet: Address;
  try {
    owner = Address.parse(ownerAddress);
    wallet = Address.parse(walletData.address);
  } catch {
    throw new DnsUpdateError(
      `Domain ${normalized} returned an invalid owner address`,
      "OWNER_INVALID"
    );
  }
  if (!owner.equals(wallet)) {
    throw new DnsUpdateError(`You don't own ${normalized}. Owner: ${ownerAddress}`, "NOT_OWNER");
  }

  return { domain: normalized, nftAddress, walletAddress: walletData.address };
}

async function updateOwnedDnsRecord(
  domain: string,
  key: bigint,
  value?: Cell | ((walletAddress: string) => Cell)
): Promise<DnsUpdateResult> {
  const owned = await getOwnedDomain(domain);
  const client = await getCachedTonClient();
  const opened = await openWallet(client);
  if (!opened) {
    throw new DnsUpdateError("Wallet key derivation failed.", "WALLET_DERIVATION_FAILED");
  }

  const recordValue = typeof value === "function" ? value(owned.walletAddress) : value;
  const bodyBuilder = beginCell()
    .storeUint(CHANGE_DNS_RECORD_OP, 32)
    .storeUint(0, 64)
    .storeUint(key, 256);
  if (recordValue) bodyBuilder.storeRef(recordValue);
  const body = bodyBuilder.endCell();

  const sent = await withTxLock(() =>
    sendWalletTx(client, opened.contract, {
      secretKey: opened.keyPair.secretKey,
      messages: [
        internal({
          to: Address.parse(owned.nftAddress),
          value: toNano("0.05"),
          body,
          bounce: true,
        }),
      ],
    })
  );
  if (!sent) {
    throw new DnsUpdateError(
      "DNS update failed or could not be confirmed on-chain.",
      "TRANSACTION_FAILED"
    );
  }

  return {
    domain: owned.domain,
    nftAddress: owned.nftAddress,
    from: owned.walletAddress,
    tx: sent,
  };
}

export async function linkDnsWallet(domain: string, address?: string): Promise<DnsUpdateResult> {
  const explicitRecord = address ? walletRecord(address) : undefined;
  return updateOwnedDnsRecord(
    domain,
    WALLET_RECORD_KEY,
    explicitRecord ?? ((walletAddress) => walletRecord(walletAddress))
  );
}

export async function unlinkDnsWallet(domain: string): Promise<DnsUpdateResult> {
  return updateOwnedDnsRecord(domain, WALLET_RECORD_KEY);
}

export async function setDnsSite(domain: string, adnlAddress: string): Promise<DnsUpdateResult> {
  return updateOwnedDnsRecord(domain, SITE_RECORD_KEY, siteRecord(adnlAddress));
}
