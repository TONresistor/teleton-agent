import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const minimum = read(".nvmrc").trim();
const supportedRange = `^${minimum} || ^24.15.0 || >=26.0.0`;
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(/^\d+\.\d+\.\d+$/.test(minimum), `.nvmrc must contain an exact version, got "${minimum}"`);

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
check(packageJson.engines?.node === supportedRange, `package.json engines.node must be ${supportedRange}`);
check(
  packageLock.packages?.[""]?.engines?.node === supportedRange,
  `package-lock.json root engines.node must be ${supportedRange}`,
);
check(read(".npmrc").split(/\r?\n/).includes("engine-strict=true"), ".npmrc must enable engine-strict");

const dockerfile = read("Dockerfile");
const dockerImage = `node:${minimum}-slim`;
check(
  [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+).*$/gm)].every(([, image]) => image === dockerImage),
  `every Docker stage must use ${dockerImage}`,
);
check((dockerfile.match(/^FROM\s+/gm) ?? []).length === 2, "Dockerfile must keep exactly two stages");

const runtimeConstants = read("src/constants/runtime.ts");
check(
  runtimeConstants.includes(`MINIMUM_NODE_VERSION = "${minimum}"`),
  "runtime minimum must match .nvmrc",
);
check(
  runtimeConstants.includes(`SUPPORTED_NODE_RANGE = "${supportedRange}"`),
  "runtime supported range must match package.json",
);
check(
  read("tsup.config.ts").includes(`target: "node${minimum.split(".")[0]}"`),
  "backend build target must match the minimum Node major",
);

const ci = read(".github/workflows/ci.yml");
check(ci.includes("node-version-file: .nvmrc"), "CI checks must use .nvmrc");
check(
  ci.includes(`node-version: ["${minimum}", "24.15.0"]`),
  "CI test matrix must cover both supported LTS minimums",
);

const release = read(".github/workflows/release.yml");
check(
  (release.match(/node-version-file: \.nvmrc/g) ?? []).length === 3,
  "every release setup-node step must use .nvmrc",
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`runtime contract: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Runtime contract verified (${supportedRange})`);
}
