import { StonApiClient } from "@ston-fi/api";
import { Asset, Factory, type Pool } from "@dedust/sdk";
import { Address } from "@ton/core";
import type { OpenedContract, TonClient } from "@ton/ton";
import { DEDUST_FACTORY_MAINNET, STONFI_PTON_ADDRESS } from "./dex-constants.js";
import { getDecimals } from "./dedust-assets.js";
import { findDedustPool } from "./dedust-pool.js";
import { toUnits } from "./units.js";
import { getCachedTonClient } from "./wallet-service.js";

export interface DexSimulationParams {
  fromAsset: string;
  toAsset: string;
  amount: number;
  slippage: number;
}

export type DecimalsResolver = (asset: string) => Promise<number>;
type StonfiSimulation = NonNullable<Awaited<ReturnType<StonApiClient["simulateSwap"]>>>;

export interface StonfiSwapSimulation {
  client: StonApiClient;
  isTonInput: boolean;
  isTonOutput: boolean;
  fromAddress: string;
  toAddress: string;
  fromDecimals: number;
  toDecimals: number;
  simulation: StonfiSimulation;
}

export interface StonfiSimulationOptions {
  client?: StonApiClient;
  resolveDecimals?: DecimalsResolver;
}

export function isStonfiTonAsset(asset: string): boolean {
  return asset.trim().toLowerCase() === "ton" || asset === STONFI_PTON_ADDRESS;
}

async function stonfiDecimals(client: StonApiClient, asset: string): Promise<number> {
  const address = isStonfiTonAsset(asset) ? STONFI_PTON_ADDRESS : asset;
  const info = await client.getAsset(address);
  return info?.decimals ?? 9;
}

export async function simulateStonfiSwap(
  params: DexSimulationParams,
  options: StonfiSimulationOptions = {}
): Promise<StonfiSwapSimulation | null> {
  const client = options.client ?? new StonApiClient();
  const resolveDecimals =
    options.resolveDecimals ?? ((asset: string) => stonfiDecimals(client, asset));
  const isTonInput = isStonfiTonAsset(params.fromAsset);
  const isTonOutput = isStonfiTonAsset(params.toAsset);
  const fromAddress = isTonInput ? STONFI_PTON_ADDRESS : params.fromAsset;
  const toAddress = isTonOutput ? STONFI_PTON_ADDRESS : params.toAsset;
  const fromDecimals = await resolveDecimals(isTonInput ? "ton" : params.fromAsset);
  const simulation = await client.simulateSwap({
    offerAddress: fromAddress,
    askAddress: toAddress,
    offerUnits: toUnits(params.amount, fromDecimals).toString(),
    slippageTolerance: params.slippage.toString(),
  });
  if (!simulation) return null;

  const toDecimals = await resolveDecimals(isTonOutput ? "ton" : params.toAsset);
  return {
    client,
    isTonInput,
    isTonOutput,
    fromAddress,
    toAddress,
    fromDecimals,
    toDecimals,
    simulation,
  };
}

export interface DedustSwapEstimate {
  tonClient: TonClient;
  factory: OpenedContract<Factory>;
  fromAsset: Asset;
  toAsset: Asset;
  fromAddress: string;
  toAddress: string;
  isTonInput: boolean;
  isTonOutput: boolean;
  pool: OpenedContract<Pool>;
  poolType: "volatile" | "stable";
  fromDecimals: number;
  toDecimals: number;
  amountIn: bigint;
  amountOut: bigint;
  tradeFee: bigint;
  minAmountOut: bigint;
}

export interface DedustEstimateOptions {
  tonClient?: TonClient;
  preferredPoolType?: "volatile" | "stable";
  resolveDecimals?: DecimalsResolver;
}

export function isDedustTonAsset(asset: string): boolean {
  return asset.trim().toLowerCase() === "ton";
}

function normalizeDedustAsset(asset: string): string {
  return isDedustTonAsset(asset) ? "ton" : Address.parse(asset).toString();
}

export function minimumAmountOut(amountOut: bigint, slippage: number): bigint {
  return amountOut - (amountOut * BigInt(Math.floor(slippage * 10_000))) / 10_000n;
}

export async function estimateDedustSwap(
  params: DexSimulationParams,
  options: DedustEstimateOptions = {}
): Promise<DedustSwapEstimate | null> {
  const tonClient = options.tonClient ?? (await getCachedTonClient());
  const resolveDecimals = options.resolveDecimals ?? getDecimals;
  const fromAddress = normalizeDedustAsset(params.fromAsset);
  const toAddress = normalizeDedustAsset(params.toAsset);
  const isTonInput = fromAddress === "ton";
  const isTonOutput = toAddress === "ton";
  const factory = tonClient.open(Factory.createFromAddress(Address.parse(DEDUST_FACTORY_MAINNET)));
  const fromAsset = isTonInput ? Asset.native() : Asset.jetton(Address.parse(fromAddress));
  const toAsset = isTonOutput ? Asset.native() : Asset.jetton(Address.parse(toAddress));
  const poolMatch = await findDedustPool(
    tonClient,
    factory,
    fromAsset,
    toAsset,
    options.preferredPoolType
  );
  if (!poolMatch) return null;

  const [fromDecimals, toDecimals] = await Promise.all([
    resolveDecimals(fromAddress),
    resolveDecimals(toAddress),
  ]);
  const amountIn = toUnits(params.amount, fromDecimals);
  const { amountOut, tradeFee } = await poolMatch.pool.getEstimatedSwapOut({
    assetIn: fromAsset,
    amountIn,
  });

  return {
    tonClient,
    factory,
    fromAsset,
    toAsset,
    fromAddress,
    toAddress,
    isTonInput,
    isTonOutput,
    pool: poolMatch.pool,
    poolType: poolMatch.poolType,
    fromDecimals,
    toDecimals,
    amountIn,
    amountOut,
    tradeFee,
    minAmountOut: minimumAmountOut(amountOut, params.slippage),
  };
}
