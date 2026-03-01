import { dnsCheckTool, dnsCheckExecutor } from "./check.js";
import { dnsAuctionsTool, dnsAuctionsExecutor } from "./auctions.js";
import { dnsResolveTool, dnsResolveExecutor } from "./resolve.js";
import { dnsStartAuctionTool, dnsStartAuctionExecutor } from "./start-auction.js";
import { dnsBidTool, dnsBidExecutor } from "./bid.js";
import { dnsLinkTool, dnsLinkExecutor } from "./link.js";
import { dnsUnlinkTool, dnsUnlinkExecutor } from "./unlink.js";
import { dnsSetSiteTool, dnsSetSiteExecutor } from "./set-site.js";
import type { ToolEntry } from "../types.js";

export { dnsCheckTool, dnsCheckExecutor };
export { dnsAuctionsTool, dnsAuctionsExecutor };
export { dnsResolveTool, dnsResolveExecutor };
export { dnsStartAuctionTool, dnsStartAuctionExecutor };
export { dnsBidTool, dnsBidExecutor };
export { dnsLinkTool, dnsLinkExecutor };
export { dnsUnlinkTool, dnsUnlinkExecutor };
export { dnsSetSiteTool, dnsSetSiteExecutor };

export const tools: ToolEntry[] = [
  { tool: dnsStartAuctionTool, executor: dnsStartAuctionExecutor, scope: "dm-only" },
  { tool: dnsBidTool, executor: dnsBidExecutor, scope: "dm-only" },
  { tool: dnsLinkTool, executor: dnsLinkExecutor, scope: "dm-only" },
  { tool: dnsUnlinkTool, executor: dnsUnlinkExecutor, scope: "dm-only" },
  { tool: dnsSetSiteTool, executor: dnsSetSiteExecutor, scope: "dm-only" },
  { tool: dnsCheckTool, executor: dnsCheckExecutor },
  { tool: dnsAuctionsTool, executor: dnsAuctionsExecutor },
  { tool: dnsResolveTool, executor: dnsResolveExecutor },
];
