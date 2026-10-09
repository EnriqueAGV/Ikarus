import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  KAPSO_API_KEY: z.string().min(1).optional(),
  KAPSO_API_BASE_URL: z.string().url().default("https://api.kapso.ai"),
  KAPSO_PROJECT_WEBHOOK_SECRET: z.string().min(1).optional(),
  KAPSO_MESSAGE_WEBHOOK_SECRET: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
