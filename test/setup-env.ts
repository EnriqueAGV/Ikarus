// Defaults for tests; DATABASE_URL must point at a disposable, migrated database.
process.env.DATABASE_URL ??= "postgres://ikarus:ikarus@localhost:5432/ikarus_test";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service";
process.env.APP_URL ??= "https://ikarus.test";
process.env.KAPSO_API_KEY ??= "kapso-test-key";
process.env.KAPSO_PROJECT_WEBHOOK_SECRET ??= "project-secret";
process.env.KAPSO_MESSAGE_WEBHOOK_SECRET ??= "message-secret";
process.env.LLM_MODEL ??= "test-model";
process.env.DATA_ENCRYPTION_KEYS ??= "1:" + Buffer.alloc(32, 7).toString("base64");
