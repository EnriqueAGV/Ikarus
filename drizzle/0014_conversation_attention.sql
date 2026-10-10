CREATE TABLE "staff_reply_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"sent_by" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_reply_attempts_status" CHECK ("staff_reply_attempts"."status" in ('pending', 'sent', 'uncertain'))
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "intake_review" text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "attention_status" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "attention_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "attention_reason" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "attention_urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_reply_attempts" ADD CONSTRAINT "staff_reply_attempts_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_reply_attempts" ADD CONSTRAINT "staff_reply_attempts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clients_attention" ON "clients" USING btree ("business_id","attention_status","attention_since") WHERE "clients"."holder_id" is null and "clients"."archived_at" is null;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_attention_status" CHECK ("clients"."attention_status" in ('needs_reply', 'follow_up', 'resolved'));
--> statement-breakpoint
-- Existing paused conversations require a deliberate human review. Their previous
-- resolution cannot be reconstructed from automated acknowledgments.
UPDATE clients SET attention_status = 'needs_reply', attention_since = now()
WHERE agent_paused AND holder_id IS NULL AND archived_at IS NULL;
--> statement-breakpoint
ALTER TABLE clients ALTER COLUMN intake_review DROP DEFAULT;
ALTER TABLE staff_reply_attempts ENABLE ROW LEVEL SECURITY;
