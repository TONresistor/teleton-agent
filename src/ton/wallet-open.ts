import { createWalletContract } from "./wallet-service.js";
import { type TonClient, type OpenedContract } from "@ton/ton";
import { getKeyPair, getCachedTonClient } from "./wallet-service.js";

type WalletV5R1 = ReturnType<typeof createWalletContract>;

export interface OpenedWallet {
  keyPair: NonNullable<Awaited<ReturnType<typeof getKeyPair>>>;
  wallet: WalletV5R1;
  contract: OpenedContract<WalletV5R1>;
}

export async function openWallet(tonClient?: TonClient): Promise<OpenedWallet | null> {
  const keyPair = await getKeyPair();
  if (!keyPair) return null;

  const wallet = createWalletContract(keyPair);
  const client = tonClient ?? (await getCachedTonClient());
  const contract = client.open(wallet);

  return { keyPair, wallet, contract };
}
