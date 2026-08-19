import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const version = read(".nvmrc").trim();
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

check(/^\d+\.\d+\.\d+$/.test(version), `.nvmrc must contain an exact version, got "${version}"`);

const packageJson = JSON.parse(read("package.json"));
const packageLock = JSON.parse(read("package-lock.json"));
check(packageJson.engines?.node === version, `package.json engines.node must be ${version}`);
check(
  packageLock.packages?.[""]?.engines?.node === version,
  `package-lock.json root engines.node must be ${version}`
);
check(
  read(".npmrc").split(/\r?\n/).includes("engine-strict=true"),
  ".npmrc must enable engine-strict"
);

const dockerfile = read("Dockerfile");
const dockerImage = `node:${version}-slim`;
check(
  [...dockerfile.matchAll(/^FROM\s+(node:[^\s]+).*$/gm)].every(
    ([, image]) => image === dockerImage
  ),
  `every Docker stage must use ${dockerImage}`
);
check(
  (dockerfile.match(/^FROM\s+/gm) ?? []).length === 2,
  "Dockerfile must keep exactly two stages"
);

const runtimeConstants = read("src/constants/runtime.ts");
check(
  runtimeConstants.includes(`SUPPORTED_NODE_VERSION = "${version}"`),
  "runtime version must match .nvmrc"
);
check(
  read("tsup.config.ts").includes(`target: "node${version.split(".")[0]}"`),
  "backend build target must match the pinned Node major"
);

const ci = read(".github/workflows/ci.yml");
check(
  (ci.match(/node-version-file: \.nvmrc/g) ?? []).length === 2,
  "every CI Node setup must use .nvmrc"
);
check(!ci.includes("matrix.node-version"), "CI must not use a Node version matrix");

const release = read(".github/workflows/release.yml");
check(
  (release.match(/node-version-file: \.nvmrc/g) ?? []).length === 3,
  "every release setup-node step must use .nvmrc"
);

if (failures.length > 0) {
  for (const failure of failures) console.error(`runtime contract: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Runtime contract verified (${version})`);
}
