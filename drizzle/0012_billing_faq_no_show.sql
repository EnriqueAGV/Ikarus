CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "invoices_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"due_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_number_unique" UNIQUE("number")
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "faq" text;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "no_show_follow_up" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "paid_until" date;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "monthly_price_cents" integer;--> statement-breakpoint
ALTER TABLE "businesses" ADD COLUMN "billing_suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_business" ON "invoices" USING btree ("business_id","period_start");--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_period_order" CHECK ("period_end" > "period_start");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount_cents" > 0);
