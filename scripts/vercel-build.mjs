// Vercel's build command (vercel.json). Production builds apply migrations
// before building; previews must prove they use their own database first and
// migrate only when opted in. See src/lib/deploy-isolation.mjs.
import { spawnSync } from "node:child_process";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
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

// Applies drizzle/ the same way `npm run db:migrate` does (same journal table),
// but in-process: drizzle-kit exits 1 without saying why when a connection or a
// migration fails. The error names the host and user, never the password.
async function migrate() {
  const name = process.env.DATABASE_MIGRATION_URL ? "DATABASE_MIGRATION_URL" : "DATABASE_URL";
  const value = process.env[name];
  if (!value) {
    console.error(`Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set for the ${target} deployment.`);
    process.exit(1);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    console.error(`${name} is not a valid URL.`);
    process.exit(1);
  }
  const where = `${decodeURIComponent(url.username)}@${url.hostname}:${url.port || 5432}`;
  const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  const sql = postgres(value, { max: 1, connect_timeout: 15, ssl: local ? false : "require", onnotice: () => {} });
  try {
    await drizzleMigrate(drizzle(sql), { migrationsFolder: "drizzle" });
    console.log(`Migrations applied to ${where} (${name}).`);
  } catch (error) {
    const cause = error?.cause ?? error;
    const details = [cause?.message ?? String(cause), cause?.detail, cause?.hint].filter(Boolean).join("\n");
    console.error(`Migrating ${where} (${name}) failed:\n${details}`);
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (shouldMigrateOnBuild(process.env)) {
  console.log(`Applying migrations for the ${target} deployment.`);
  await migrate();
} else {
  console.log(`Skipping migrations for the ${target} deployment.`);
}
run("build");
