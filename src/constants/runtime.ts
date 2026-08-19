export const SUPPORTED_NODE_VERSION = "22.22.2";

export function isNodeVersionSupported(value: string): boolean {
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(value.trim());
  return match?.[1] === SUPPORTED_NODE_VERSION;
}
