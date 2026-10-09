-- Two live appointments of the same business can never overlap in time.
-- A booking that races another for the same slot fails with 23P01 (exclusion_violation).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "business_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" IN ('booked', 'reminder_sent', 'followup_sent', 'confirmed'));
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_valid_range" CHECK ("ends_at" > "starts_at");
