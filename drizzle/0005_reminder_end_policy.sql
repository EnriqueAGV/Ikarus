CREATE TYPE "public"."reminder_end_policy" AS ENUM('escalate', 'auto_cancel');--> statement-breakpoint
ALTER TABLE "businesses" ALTER COLUMN "timezone" SET DEFAULT 'America/El_Salvador';--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "escalated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "reminder_end_policy" "reminder_end_policy" DEFAULT 'escalate' NOT NULL;