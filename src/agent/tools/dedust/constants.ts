/**
 * DeDust DEX constants
 */

// Factory contract address on mainnet
export const DEDUST_FACTORY_MAINNET = "EQBfBWT7X2BHg9tXAxzhz2aKiNTU1tpt5NsiK0uSDW_YAJ67";

// DeDust API URL
export const DEDUST_API_URL = "https://api.dedust.io/v2";

// Gas amounts for different operations (in TON)
export const DEDUST_GAS = {
  // TON to Jetton swap
  SWAP_TON_TO_JETTON: "0.25",
  // Jetton to any asset swap
  SWAP_JETTON_TO_ANY: "0.3",
  // Extra gas for multi-hop swaps
  MULTIHOP_EXTRA: "0.1",
  // Forward gas for jetton transfers
  FORWARD_GAS: "0.2",
};

// Native TON address (zero address used in DeDust)
export const NATIVE_TON_ADDRESS = "EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c";
