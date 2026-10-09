CREATE TYPE "public"."access_action" AS ENUM('view_chart', 'edit_chart', 'edit_clinical');--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male');--> statement-breakpoint
CREATE TABLE "access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"practitioner_id" uuid,
	"action" "access_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"notice_version" text NOT NULL,
	"message_id" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Roles become doctor and assistant. An owner was the doctor who runs the
-- clinic, so they keep managing it through manages_clinic.
ALTER TYPE "public"."member_role" RENAME VALUE 'owner' TO 'doctor';--> statement-breakpoint
ALTER TYPE "public"."member_role" RENAME VALUE 'staff' TO 'assistant';--> statement-breakpoint
ALTER TABLE "business_members" ALTER COLUMN "role" SET DEFAULT 'assistant';--> statement-breakpoint
ALTER TABLE "business_members" ADD COLUMN "manages_clinic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "business_members" SET "manages_clinic" = true WHERE "role" = 'doctor';--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "sex" "patient_sex";--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "dui" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "guardian_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "guardian_phone" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "emergency_contact_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "emergency_contact_phone" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "chronic_conditions" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "preferred_practitioner_id" uuid;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ADD CONSTRAINT "access_log_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_log_client_time" ON "access_log" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_client_version" ON "consents" USING btree ("client_id","notice_version");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_preferred_practitioner_id_practitioners_id_fk" FOREIGN KEY ("preferred_practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
