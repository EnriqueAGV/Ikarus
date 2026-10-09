-- Calendars move from the business to the practitioner (doctor). Existing
-- schedules and appointments are not backfilled: Praxia starts clean, so this
-- migration refuses to run while any business exists. Delete the old test
-- business first (see the PR), then deploy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "businesses") THEN
    RAISE EXCEPTION 'Delete existing businesses before applying 0004_practitioners: calendars now belong to practitioners and old rows are not backfilled.';
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE "practitioner_services" (
	"business_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"duration_min" integer,
	CONSTRAINT "practitioner_services_practitioner_id_service_id_pk" PRIMARY KEY("practitioner_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "practitioners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"member_id" uuid,
	"display_name" text NOT NULL,
	"specialty" text,
	"jvpm_number" text,
	"color" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "availability_exceptions_business";--> statement-breakpoint
DROP INDEX "availability_rules_business";--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "practitioner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD COLUMN "practitioner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD COLUMN "practitioner_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioner_services" ADD CONSTRAINT "practitioner_services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_services" ADD CONSTRAINT "practitioner_services_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioner_services" ADD CONSTRAINT "practitioner_services_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practitioners" ADD CONSTRAINT "practitioners_member_id_business_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."business_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practitioner_services_service" ON "practitioner_services" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "practitioners_business" ON "practitioners" USING btree ("business_id");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_practitioner_time" ON "appointments" USING btree ("practitioner_id","starts_at");--> statement-breakpoint
CREATE INDEX "availability_exceptions_practitioner" ON "availability_exceptions" USING btree ("practitioner_id","date");--> statement-breakpoint
CREATE INDEX "availability_rules_practitioner" ON "availability_rules" USING btree ("practitioner_id","weekday");--> statement-breakpoint
-- Two live appointments of the same practitioner can never overlap; two
-- doctors in one clinic can see patients at the same time.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "practitioner_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('booked', 'reminder_sent', 'followup_sent', 'confirmed'));--> statement-breakpoint
-- Same as 0003: no Data API access to the new tables.
ALTER TABLE "practitioners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practitioner_services" ENABLE ROW LEVEL SECURITY;
