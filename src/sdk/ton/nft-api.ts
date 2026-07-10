import type { NftItem } from "@teleton-agent/sdk";

export interface TonApiNftItem {
  address: string;
  index?: number;
  owner?: { address?: string };
  collection?: { address?: string; name?: string };
  metadata?: { name?: string; description?: string; image?: string };
  previews?: Array<{ resolution: string; url: string }>;
  trust?: string;
  dns?: string;
}

export function mapNftItem(item: TonApiNftItem): NftItem {
  const meta = item.metadata || {};
  const collection = item.collection || {};
  const previews = item.previews || [];
  const preview = previews[1]?.url || previews[0]?.url;

  return {
    address: item.address,
    index: item.index ?? 0,
    ownerAddress: item.owner?.address || undefined,
    collectionAddress: collection.address || undefined,
    collectionName: collection.name || undefined,
    name: meta.name || undefined,
    description: meta.description ? meta.description.slice(0, 200) : undefined,
    image: preview || meta.image || undefined,
    verified: item.trust === "whitelist",
  };
}
