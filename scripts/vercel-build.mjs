// Vercel's build command (vercel.json). Production builds apply migrations
// before building; previews must prove they use their own database first and
// migrate only when opted in. See src/lib/deploy-isolation.mjs.
import { spawnSync } from "node:child_process";
import { assertDeploymentIsolation, shouldMigrateOnBuild } from "../src/lib/deploy-isolation.mjs";

function run(script) {
  const result = spawnSync("npm", ["run", script], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const target = process.env.VERCEL_ENV ?? "unknown";
try {
  assertDeploymentIsolation(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

if (shouldMigrateOnBuild(process.env)) {
  console.log(`Applying migrations for the ${target} deployment.`);
  run("db:migrate");
} else {
  console.log(`Skipping migrations for the ${target} deployment.`);
}
run("build");
