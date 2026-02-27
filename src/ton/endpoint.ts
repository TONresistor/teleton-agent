const ENDPOINT_CACHE_TTL_MS = 60_000;
const ORBS_HOST = "ton.access.orbs.network";
const ORBS_TOPOLOGY_URL = `https://${ORBS_HOST}/mngr/nodes?npm_version=2.3.3`;
const TONCENTER_URL = `https://toncenter.com/api/v2/jsonRPC`;

let _cache: { url: string; ts: number } | null = null;
let _toncenterApiKey: string | undefined;

export function setToncenterApiKey(key: string | undefined): void {
  _toncenterApiKey = key;
}

export function getToncenterApiKey(): string | undefined {
  return _toncenterApiKey;
}

interface OrbsNode {
  NodeId: string;
  Healthy: string;
  Weight: number;
  Mngr?: { health?: Record<string, boolean> };
}

async function discoverOrbsEndpoint(): Promise<string> {
  const res = await fetch(ORBS_TOPOLOGY_URL, { signal: AbortSignal.timeout(5_000) });
  const nodes: OrbsNode[] = await res.json();

  const healthy = nodes.filter(
    (n) => n.Healthy === "1" && n.Weight > 0 && n.Mngr?.health?.["v2-mainnet"]
  );
  if (healthy.length === 0) throw new Error("no healthy orbs nodes");

  const totalWeight = healthy.reduce((sum, n) => sum + n.Weight, 0);
  let r = Math.floor(Math.random() * totalWeight);
  let chosen = healthy[0];
  for (const node of healthy) {
    r -= node.Weight;
    if (r < 0) {
      chosen = node;
      break;
    }
  }

  return `https://${ORBS_HOST}/${chosen.NodeId}/1/mainnet/toncenter-api-v2/jsonRPC`;
}

/**
 * With API key: TonCenter primary → ORBS fallback.
 * Without API key: ORBS primary → TonCenter fallback (too slow for agent).
 */
export async function getCachedHttpEndpoint(): Promise<string> {
  if (_cache && Date.now() - _cache.ts < ENDPOINT_CACHE_TTL_MS) {
    return _cache.url;
  }

  let url: string;
  if (_toncenterApiKey) {
    // API key configured — TonCenter primary
    try {
      const testUrl = `https://toncenter.com/api/v2/getAddressInformation?address=EQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM9c`;
      const res = await fetch(testUrl, {
        headers: { "X-API-Key": _toncenterApiKey },
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`TonCenter ${res.status}`);
      url = TONCENTER_URL;
    } catch {
      try {
        url = await discoverOrbsEndpoint();
      } catch {
        url = TONCENTER_URL;
      }
    }
  } else {
    // No API key — ORBS primary, TonCenter fallback
    try {
      url = await discoverOrbsEndpoint();
    } catch {
      url = TONCENTER_URL;
    }
  }
  _cache = { url, ts: Date.now() };
  return url;
}

/** Call this when a node returns a 5xx error — forces re-discovery on next call. */
export function invalidateEndpointCache(): void {
  _cache = null;
}
