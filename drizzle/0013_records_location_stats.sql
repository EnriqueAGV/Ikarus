CREATE TYPE "public"."attachment_kind" AS ENUM('lab', 'image', 'other');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('assistant', 'staff');--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'merge_patient';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'create_prescription';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'print_prescription';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'upload_attachment';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'view_attachment';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'delete_attachment';--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"appointment_id" uuid,
	"kind" "attachment_kind" DEFAULT 'other' NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_path_unique" UNIQUE("storage_path")
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"appointment_id" uuid,
	"items" text NOT NULL,
	"instructions" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "booked_by" "booking_source";--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "maps_url" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_lat" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_lng" double precision;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "location_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "merged_into_id" uuid;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_profiles_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_client_time" ON "attachments" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "prescriptions_client_time" ON "prescriptions" USING btree ("client_id","created_at");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_merged_into_id_clients_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prescriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- An issued prescription never changes and is never deleted, like a signed note.
CREATE FUNCTION "prescriptions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prescriptions cannot be changed or deleted' USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "prescriptions_immutable" BEFORE UPDATE OR DELETE ON "prescriptions"
  FOR EACH ROW EXECUTE FUNCTION "prescriptions_immutable"();--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_not_merged_into_self" CHECK ("merged_into_id" IS NULL OR "merged_into_id" <> "id");
