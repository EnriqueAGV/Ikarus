ALTER TYPE "public"."access_action" ADD VALUE 'archive_patient';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'restore_patient';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "archived_at" timestamp with time zone;