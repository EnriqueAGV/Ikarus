import { defineConfig } from "drizzle-kit";
import { withTls } from "./src/db/tls";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { // Migrations need a session connection; the app can use the transaction pooler.
    url: withTls(process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL!) },
});
