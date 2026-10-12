import {
  createHash,
  createHmac,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  pbkdf2Sync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { keyPairFromSeed, mnemonicWordList, sign } from "@ton/crypto";
import {
  type Address,
  beginCell,
  Cell,
  contractAddress,
  internal,
  storeMessageRelaxed,
  type ContractProvider,
  type Sender,
  SendMode,
} from "@ton/core";

const P = (1n << 255n) - 19n;
const hash = (value: Buffer) => createHash("sha256").update(value).digest();
const hmac = (key: Buffer | string, value: Buffer | string, algorithm = "sha512") =>
  createHmac(algorithm, key).update(value).digest();
function power(value: bigint, exponent: bigint): bigint {
  let result = 1n;
  for (; exponent; exponent >>= 1n, value = (value * value) % P)
    if (exponent & 1n) result = (result * value) % P;
  return result;
}
export function walletSharedSecret(seed: Buffer, publicKey: Buffer): Buffer {
  if (seed.length !== 32 || publicKey.length !== 32) throw new Error("PHRASE_PART_INVALID");
  const encoded = Buffer.from(publicKey);
  encoded[31] &= 127;
  const y = BigInt(`0x${Buffer.from(encoded).reverse().toString("hex")}`);
  if (y >= P || y === 1n) throw new Error("PHRASE_PART_INVALID");
  const u = ((y + 1n) * power((P + 1n - y) % P, P - 2n)) % P;
  const peer = Buffer.from(u.toString(16).padStart(64, "0"), "hex").reverse();
  const privateBytes = createHash("sha512").update(seed).digest();
  privateBytes[0] &= 248;
  privateBytes[31] &= 127;
  privateBytes[31] |= 64;
  try {
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b656e04220420", "hex"),
        privateBytes.subarray(0, 32),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const peerKey = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), peer]),
      format: "der",
      type: "spki",
    });
    const raw = diffieHellman({ privateKey, publicKey: peerKey });
    try {
      return Buffer.from(hmac("tde2e_shared_secret", raw).subarray(0, 32));
    } finally {
      raw.fill(0);
    }
  } finally {
    privateBytes.fill(0);
  }
}
export function decryptWalletData(ciphertext: Buffer, secret: Buffer): Buffer {
  if (ciphertext.length < 32 || ciphertext.length % 16) throw new Error("PHRASE_PART_INVALID");
  const expanded = hmac(secret, "tde2e_encrypt_data");
  const msgId = ciphertext.subarray(0, 16);
  const aes = hmac(expanded.subarray(0, 32), msgId);
  let plain: Buffer | undefined;
  try {
    const cipher = createDecipheriv("aes-256-cbc", aes.subarray(0, 32), aes.subarray(32, 48));
    cipher.setAutoPadding(false);
    plain = Buffer.concat([cipher.update(ciphertext.subarray(16)), cipher.final()]);
    const mac = hmac(
      expanded.subarray(32, 64),
      Buffer.concat([plain, Buffer.alloc(4)]),
      "sha256"
    ).subarray(0, 16);
    if (!timingSafeEqual(mac, msgId) || plain[0] < 16 || plain[0] > plain.length)
      throw new Error("PHRASE_PART_INVALID");
    return Buffer.from(plain.subarray(plain[0]));
  } finally {
    expanded.fill(0);
    aes.fill(0);
    plain?.fill(0);
  }
}
export function decryptWalletShare(data: Buffer, seed: Buffer): Buffer {
  if (data.length <= 32) throw new Error("PHRASE_PART_INVALID");
  const secret = walletSharedSecret(seed, data.subarray(0, 32));
  let plain: Buffer | undefined;
  try {
    plain = decryptWalletData(data.subarray(32), secret);
    if (plain.length < 8 || plain.length % 4 || plain.readUInt32LE(0) !== 0x8b90dd08)
      throw new Error("PHRASE_PART_INVALID");
    const marker = plain[4];
    if (marker === 255) throw new Error("PHRASE_PART_INVALID");
    const header = marker === 254 ? 4 : 1;
    const length = marker === 254 ? plain.readUIntLE(5, 3) : marker;
    const end = 4 + header + length;
    if (
      length !== 215 ||
      plain.length !== end + ((4 - ((header + length) % 4)) % 4) ||
      plain.subarray(end).some((byte) => byte !== 0)
    )
      throw new Error("PHRASE_PART_INVALID");
    return Buffer.from(plain.subarray(4 + header, end));
  } finally {
    secret.fill(0);
    plain?.fill(0);
  }
}
export function combineWalletShares(shares: Buffer[]): Buffer {
  if (!shares.length || shares.some((part) => part.length !== 215))
    throw new Error("PHRASE_PART_INVALID");
  const result = Buffer.alloc(215);
  for (const part of shares) for (let i = 0; i < result.length; ++i) result[i] ^= part[i];
  return result;
}
function deriveHalf(words: string[]): Buffer {
  const list = [...mnemonicWordList].sort();
  const indexes = words.map((word) => list.indexOf(word));
  if (words.length !== 12 || indexes.some((index) => index < 0)) throw new Error("PHRASE_INVALID");
  const bits = indexes.map((index) => index.toString(2).padStart(11, "0")).join("");
  const entropy = Buffer.from(
    Array.from({ length: 16 }, (_, i) => Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2))
  );
  if (Number.parseInt(bits.slice(128), 2) !== hash(entropy)[0] >> 4)
    throw new Error("PHRASE_INVALID");
  const seed = pbkdf2Sync(words.join(" ").normalize("NFKD"), "mnemonic", 2048, 64, "sha512");
  let node = hmac("ed25519 seed", seed);
  seed.fill(0);
  entropy.fill(0);
  try {
    for (const index of [44, 607, 0]) {
      const child = Buffer.alloc(37);
      node.copy(child, 1, 0, 32);
      child.writeUInt32BE(index + 0x80000000, 33);
      const next = hmac(node.subarray(32), child);
      node.fill(0);
      child.fill(0);
      node = next;
    }
    return Buffer.from(node.subarray(0, 32));
  } finally {
    node.fill(0);
  }
}
export function deriveTelegramWalletKeys(phrase: Buffer) {
  const words = phrase.toString("utf8").trim().toLowerCase().split(/\s+/);
  if (words.length !== 12 && words.length !== 24) throw new Error("PHRASE_INVALID");
  const anchorSeed = deriveHalf(words.slice(0, 12));
  try {
    return {
      anchorSeed,
      signingSeed: words.length === 12 ? Buffer.from(anchorSeed) : deriveHalf(words.slice(12)),
    };
  } catch (error) {
    anchorSeed.fill(0);
    throw error;
  } finally {
    words.fill("");
  }
}

export class NativeTelegramWallet {
  readonly init;
  readonly address: Address;
  constructor(
    readonly publicKey: Buffer,
    readonly walletId = 0x7fff7f11
  ) {
    const code = Cell.fromBase64("te6ccgEBAQEAGgAAMP8AIJgh10mDCLnyQN+Ahfgz0O0eIO1T2Q==");
    if (
      code.hash().toString("hex") !==
      "9149ae51c1e4689710cebf7830297b16acfbadb363a920a537893e7ffeeca768"
    )
      throw new Error("WALLET_CODE_INVALID");
    const data = beginCell()
      .storeUint(0, 8)
      .storeUint(0, 32)
      .storeUint(walletId, 32)
      .storeBuffer(publicKey)
      .endCell();
    this.init = { code, data };
    this.address = contractAddress(0, this.init);
  }
  async getSeqno(provider: ContractProvider): Promise<number> {
    const state = await provider.getState();
    if (state.state.type !== "active") return 0;
    if (!state.state.data) throw new Error("WALLET_STORAGE_INVALID");
    const data = Cell.fromBoc(state.state.data)[0].beginParse();
    data.skip(8);
    return data.loadUint(32);
  }
  createTransfer(args: {
    seqno: number;
    secretKey: Buffer;
    timeout?: number;
    sendMode?: SendMode;
    messages: ReturnType<typeof internal>[];
  }): Cell {
    if (!args.messages.length || args.messages.length > 255)
      throw new Error("WALLET_MESSAGE_COUNT_INVALID");
    if (args.seqno === 0 && !args.secretKey.subarray(32).equals(this.publicKey))
      throw new Error("ROTATED_WALLET_REQUIRES_ACTIVE_ACCOUNT");
    const mode = (args.sendMode ?? SendMode.PAY_GAS_SEPARATELY) | SendMode.IGNORE_ERRORS;
    const cells = args.messages.map((message) =>
      beginCell().store(storeMessageRelaxed(message)).endCell()
    );
    const request = beginCell()
      .storeUint(cells.length === 1 ? 0x63896e75 : 0x73896e75, 32)
      .storeUint(this.walletId, 32)
      .storeUint(args.timeout ?? Math.floor(Date.now() / 1000) + 120, 32)
      .storeUint(args.seqno, 32);
    if (cells.length === 1) request.storeUint(mode, 8).storeRef(cells[0]);
    else {
      let tail: Cell | undefined;
      let end = cells.length;
      while (end > 0) {
        const start = Math.max(0, end - (tail ? 3 : 4));
        const chunk = beginCell();
        chunk.storeMaybeRef(tail);
        for (let i = start; i < end; i++) chunk.storeUint(mode, 8).storeRef(cells[i]);
        tail = chunk.endCell();
        end = start;
      }
      request.storeUint(cells.length, 8).storeMaybeRef(tail);
    }
    const body = request.endCell();
    return beginCell()
      .storeBuffer(sign(body.hash(), args.secretKey))
      .storeSlice(body.beginParse())
      .endCell();
  }
  async sendTransfer(
    provider: ContractProvider,
    args: Parameters<NativeTelegramWallet["createTransfer"]>[0]
  ) {
    const state = await provider.getState();
    if (state.state.type === "active") {
      if (!state.state.data) throw new Error("WALLET_STORAGE_INVALID");
      const data = Cell.fromBoc(state.state.data)[0].beginParse();
      data.skip(8 + 32 + 32);
      if (!data.loadBuffer(32).equals(args.secretKey.subarray(32)))
        throw new Error("WALLET_SIGNING_KEY_MISMATCH");
    }
    await provider.external(this.createTransfer(args));
  }
  sender(provider: ContractProvider, secretKey: Buffer): Sender {
    return {
      address: this.address,
      send: async (args) => {
        await this.sendTransfer(provider, {
          seqno: await this.getSeqno(provider),
          secretKey,
          sendMode: args.sendMode ?? undefined,
          messages: [
            internal({
              to: args.to,
              value: args.value,
              body: args.body,
              bounce: args.bounce ?? true,
              init: args.init,
            }),
          ],
        });
      },
    };
  }
}
export function generateWalletEphemeralKey() {
  const seed = randomBytes(32);
  const keys = keyPairFromSeed(seed);
  keys.secretKey.fill(0);
  return { seed, publicKey: keys.publicKey };
}

export function generateTelegramWalletMnemonic(): string[] {
  const list = [...mnemonicWordList].sort();
  const entropy = randomBytes(16);
  try {
    const bits =
      [...entropy].map((byte) => byte.toString(2).padStart(8, "0")).join("") +
      (hash(entropy)[0] >> 4).toString(2).padStart(4, "0");
    return Array.from(
      { length: 12 },
      (_, i) => list[Number.parseInt(bits.slice(i * 11, i * 11 + 11), 2)]
    );
  } finally {
    entropy.fill(0);
  }
}

export function signWalletOwnershipProof(
  address: Address,
  domain: string,
  timestamp: number,
  payload: string,
  secretKey: Buffer
): Buffer {
  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(address.workChain);
  const domainBytes = Buffer.from(domain, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(domainBytes.length);
  const time = Buffer.alloc(8);
  time.writeBigUInt64LE(BigInt(timestamp));
  const message = Buffer.concat([
    Buffer.from("ton-proof-item-v2/"),
    workchain,
    address.hash,
    length,
    domainBytes,
    time,
    Buffer.from(payload, "utf8"),
  ]);
  return sign(
    hash(Buffer.concat([Buffer.from([255, 255]), Buffer.from("ton-connect"), hash(message)])),
    secretKey
  );
}
