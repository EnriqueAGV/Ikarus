DROP INDEX "clients_phone";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "wa_phone" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "holder_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_holder_id_clients_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_phone_holder" ON "clients" USING btree ("business_id","wa_phone") WHERE "clients"."holder_id" is null and "clients"."wa_phone" is not null;--> statement-breakpoint
CREATE INDEX "clients_holder" ON "clients" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "clients_phone" ON "clients" USING btree ("business_id","wa_phone");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_holder_not_self" CHECK ("holder_id" IS NULL OR "holder_id" <> "id");
