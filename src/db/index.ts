import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Server-only connection. Tenancy is enforced in code: every query on
// business-owned tables filters by business_id.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
export { schema };
