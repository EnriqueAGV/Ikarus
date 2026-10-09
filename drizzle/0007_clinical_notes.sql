CREATE TYPE "public"."note_status" AS ENUM('draft', 'signed');--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'create_note';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'sign_note';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'add_addendum';--> statement-breakpoint
ALTER TYPE "public"."access_action" ADD VALUE 'print_note';--> statement-breakpoint
CREATE TABLE "clinical_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"practitioner_id" uuid NOT NULL,
	"appointment_id" uuid,
	"number" integer,
	"subjective" text,
	"objective" text,
	"vitals" text,
	"assessment" text,
	"diagnosis_codes" text[] DEFAULT '{}' NOT NULL,
	"plan" text,
	"status" "note_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"signed_at" timestamp with time zone,
	"signed_by" uuid,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_addenda" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"practitioner_id" uuid,
	"body" text NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Intake answers and message payloads are now encrypted by the app, so they
-- become text. Existing rows keep their JSON as plain text, which the app
-- still reads; `npm run db:encrypt` rewrites them encrypted.
ALTER TABLE "clients" ALTER COLUMN "data" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "data" SET DATA TYPE text USING "data"::text;--> statement-breakpoint
ALTER TABLE "messages" ALTER COLUMN "payload" SET DATA TYPE text USING "payload"::text;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signed_by_profiles_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_addenda" ADD CONSTRAINT "note_addenda_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_addenda" ADD CONSTRAINT "note_addenda_note_id_clinical_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."clinical_notes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_addenda" ADD CONSTRAINT "note_addenda_author_id_profiles_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_addenda" ADD CONSTRAINT "note_addenda_practitioner_id_practitioners_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_notes_number" ON "clinical_notes" USING btree ("client_id","number");--> statement-breakpoint
CREATE INDEX "clinical_notes_client_time" ON "clinical_notes" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "note_addenda_note" ON "note_addenda" USING btree ("note_id","created_at");--> statement-breakpoint
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signed_complete" CHECK (
  "status" = 'draft' OR ("number" IS NOT NULL AND "signed_at" IS NOT NULL AND "signed_by" IS NOT NULL AND "content_hash" IS NOT NULL)
);--> statement-breakpoint
-- A signed note can never be changed or deleted (Art. 42 g); corrections go
-- in addenda. Signing gives the note the patient's next number (Art. 44 f).
CREATE FUNCTION "clinical_notes_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'signed' THEN
      RAISE EXCEPTION 'signed clinical notes cannot be deleted' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'signed' THEN
    RAISE EXCEPTION 'signed clinical notes cannot be changed' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'signed' THEN
    PERFORM pg_advisory_xact_lock(hashtext('clinical_notes:' || NEW."client_id"::text));
    SELECT coalesce(max("number"), 0) + 1 INTO NEW."number" FROM "clinical_notes" WHERE "client_id" = NEW."client_id";
  ELSE
    NEW."number" := NULL;
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "clinical_notes_guard" BEFORE UPDATE OR DELETE ON "clinical_notes"
  FOR EACH ROW EXECUTE FUNCTION "clinical_notes_guard"();--> statement-breakpoint
-- Notes are created as drafts; only an update can sign one.
CREATE FUNCTION "clinical_notes_insert_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" <> 'draft' OR NEW."number" IS NOT NULL THEN
    RAISE EXCEPTION 'clinical notes start as drafts' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "clinical_notes_insert_guard" BEFORE INSERT ON "clinical_notes"
  FOR EACH ROW EXECUTE FUNCTION "clinical_notes_insert_guard"();--> statement-breakpoint
-- Addenda go on signed notes only and are never changed or deleted.
CREATE FUNCTION "note_addenda_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'addenda cannot be changed or deleted' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "clinical_notes" WHERE "id" = NEW."note_id" AND "status" = 'signed') THEN
    RAISE EXCEPTION 'addenda go on signed notes only' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "note_addenda_guard" BEFORE INSERT OR UPDATE OR DELETE ON "note_addenda"
  FOR EACH ROW EXECUTE FUNCTION "note_addenda_guard"();--> statement-breakpoint
ALTER TABLE "clinical_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "note_addenda" ENABLE ROW LEVEL SECURITY;
