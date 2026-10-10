import postgres from "postgres";

// This bootstrap belongs only to plain Postgres integration tests. Production
// Supabase supplies these objects itself; migrations must never replace them.
const url = new URL(process.env.DATABASE_URL ?? "postgres://ikarus:ikarus@localhost:5432/ikarus_test");
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.endsWith("_test")) {
  throw new Error("Test database bootstrap requires a local database named *_test");
}
const db = postgres(url.toString(), { prepare: false });
try {
  await db.file(new URL("./supabase-fixtures.sql", import.meta.url).pathname);
  console.log("Supabase Auth and Realtime fixtures installed in the local test database.");
} finally {
  await db.end();
}
