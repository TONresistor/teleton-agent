export const MINIMUM_NODE_VERSION = "22.22.2";
export const SUPPORTED_NODE_RANGE = "^22.22.2 || ^24.15.0 || >=26.0.0";

type Version = readonly [major: number, minor: number, patch: number];

function parseVersion(value: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAtLeast(version: Version, minimum: Version): boolean {
  for (let index = 0; index < version.length; index += 1) {
    if (version[index] !== minimum[index]) {
      return version[index] > minimum[index];
    }
  }
  return true;
}

export function isNodeVersionSupported(value: string): boolean {
  const version = parseVersion(value);
  if (!version) return false;

  if (version[0] === 22) return isAtLeast(version, [22, 22, 2]);
  if (version[0] === 24) return isAtLeast(version, [24, 15, 0]);
  return version[0] >= 26;
}
