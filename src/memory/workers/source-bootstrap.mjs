import { register } from "tsx/esm/api";

const entryUrl = process.argv[2];
if (!entryUrl) throw new Error("Memory worker source entry URL is required");

register();
await import(entryUrl);
