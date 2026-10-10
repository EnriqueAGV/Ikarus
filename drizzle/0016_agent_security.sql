ALTER TABLE "clients" ADD COLUMN "wa_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "wa_verify_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "identity_reviewed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "messages_kapso_id" ON "messages" USING btree ("business_id","kapso_message_id");--> statement-breakpoint
-- Numbers that already wrote to the clinic are taken as verified, so
-- existing conversations carry on. Only staff-typed numbers that never wrote
-- in start unverified.
UPDATE "clients" SET "wa_verified_at" = now()
WHERE "holder_id" IS NULL AND "wa_phone" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "messages" m WHERE m."client_id" = "clients"."id" AND m."direction" = 'inbound');--> statement-breakpoint
-- Records staff created or edited keep their name and DUI.
UPDATE "clients" SET "identity_reviewed_at" = now()
WHERE EXISTS (SELECT 1 FROM "access_log" a WHERE a."client_id" = "clients"."id" AND a."action" = 'edit_chart');
