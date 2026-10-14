import { execFileSync } from "node:child_process";

const run = (command, args) => execFileSync(command, args, { encoding: "utf8" }).trim();
const repo = process.env.GITHUB_REPOSITORY;
if (!repo || !process.env.GITHUB_REF_NAME?.startsWith("v"))
  throw new Error("Expected a GitHub version tag event");
run("git", ["fetch", "origin", "+refs/heads/main:refs/remotes/origin/main"]);
const commit = run("git", ["rev-parse", "HEAD"]);
if (commit !== run("git", ["rev-parse", `refs/tags/${process.env.GITHUB_REF_NAME}^{commit}`]))
  throw new Error("Release tag does not resolve to the checked-out commit");
if (commit !== run("git", ["rev-parse", "origin/main"]))
  throw new Error("Release tag must target the current main commit");
const result = JSON.parse(
  run("gh", [
    "api",
    `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${commit}&branch=main&event=push&per_page=100`,
  ])
);
const runs = result.workflow_runs.filter(
  (entry) => entry.head_sha === commit && entry.head_branch === "main"
);
runs.sort((a, b) => b.run_number - a.run_number);
if (!runs.length || runs[0].status !== "completed" || runs[0].conclusion !== "success") {
  throw new Error("The latest CI run on the main release commit must have completed successfully");
}
console.log("Release target verified against main and its required CI");
