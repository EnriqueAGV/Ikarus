import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const businessId = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" });

export const memberRole = pgEnum("member_role", ["owner", "staff"]);
export const businessStatus = pgEnum("business_status", [
  "invited",
  "connected",
  "active",
  "disabled",
]);
export const setupLinkStatus = pgEnum("setup_link_status", [
  "pending",
  "completed",
  "failed",
  "expired",
]);
export const intakeFieldType = pgEnum("intake_field_type", [
  "text",
  "date",
  "choice",
]);
export const appointmentStatus = pgEnum("appointment_status", [
  "booked",
  "reminder_sent",
  "followup_sent",
  "confirmed",
  "cancelled_by_client",
  "cancelled_by_business",
  "auto_cancelled",
  "completed",
  "no_show",
]);
export const messageDirection = pgEnum("message_direction", [
  "inbound",
  "outbound",
]);
export const templateStatus = pgEnum("template_status", [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "DISABLED",
]);

// One row per Supabase Auth user. Super-admins do not need a business.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // = auth.users.id
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  createdAt: createdAt(),
});

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("America/Mexico_City"),
    locale: text("locale").notNull().default("es"),
    status: businessStatus("status").notNull().default("invited"),
    kapsoCustomerId: text("kapso_customer_id").unique(),
    phoneNumberId: text("phone_number_id").unique(),
    wabaId: text("waba_id"),
    kapsoMessageWebhookId: text("kapso_message_webhook_id"),
    displayPhone: text("display_phone"),
    reminderLeadHours: smallint("reminder_lead_hours").notNull().default(24),
    agentInstructions: text("agent_instructions"),
    createdAt: createdAt(),
  },
);

export const businessMembers = pgTable(
  "business_members",
  {
    id: id(),
    businessId: businessId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: memberRole("role").notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("business_members_unique").on(t.businessId, t.userId)],
);

// A doctor with a calendar. Every schedule and appointment belongs to one, so a
// clinic with several doctors needs no migration; a solo practice has one row.
// member_id links the doctor's login, if they have one.
export const practitioners = pgTable(
  "practitioners",
  {
    id: id(),
    businessId: businessId(),
    memberId: uuid("member_id").references(() => businessMembers.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    specialty: text("specialty"),
    jvpmNumber: text("jvpm_number"),
    color: text("color"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("practitioners_business").on(t.businessId)],
);

export const setupLinks = pgTable("setup_links", {
  id: id(),
  businessId: businessId(),
  kapsoSetupLinkId: text("kapso_setup_link_id").notNull().unique(),
  url: text("url").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  status: setupLinkStatus("status").notNull().default("pending"),
  errorCode: text("error_code"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: createdAt(),
});

export const services = pgTable("services", {
  id: id(),
  businessId: businessId(),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  bufferMin: integer("buffer_min").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

const practitionerId = () =>
  uuid("practitioner_id")
    .notNull()
    .references(() => practitioners.id, { onDelete: "cascade" });

// Which doctor offers which service, with an optional per-doctor duration.
export const practitionerServices = pgTable(
  "practitioner_services",
  {
    businessId: businessId(),
    practitionerId: practitionerId(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    durationMin: integer("duration_min"),
  },
  (t) => [
    primaryKey({ columns: [t.practitionerId, t.serviceId] }),
    index("practitioner_services_service").on(t.serviceId),
  ],
);

// A doctor's weekly hours, in the business's timezone. weekday: 0 = Sunday.
export const availabilityRules = pgTable(
  "availability_rules",
  {
    id: id(),
    businessId: businessId(),
    practitionerId: practitionerId(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [index("availability_rules_practitioner").on(t.practitionerId, t.weekday)],
);

// A day off (no times) or custom hours for one doctor on one date.
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: id(),
    businessId: businessId(),
    practitionerId: practitionerId(),
    date: date("date").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    note: text("note"),
  },
  (t) => [index("availability_exceptions_practitioner").on(t.practitionerId, t.date)],
);

// What the agent must collect from a new client, configured per business.
export const intakeFields = pgTable(
  "intake_fields",
  {
    id: id(),
    businessId: businessId(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    type: intakeFieldType("type").notNull().default("text"),
    options: jsonb("options").$type<string[]>(),
    required: boolean("required").notNull().default(true),
    position: integer("position").notNull().default(0),
  },
  (t) => [uniqueIndex("intake_fields_key").on(t.businessId, t.key)],
);

export const clients = pgTable(
  "clients",
  {
    id: id(),
    businessId: businessId(),
    waPhone: text("wa_phone").notNull(), // E.164 without "+", as WhatsApp sends it
    name: text("name"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    agentPaused: boolean("agent_paused").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("clients_phone").on(t.businessId, t.waPhone)],
);

// A Postgres exclusion constraint (see drizzle/0001_appointments_no_overlap.sql)
// rejects overlapping live appointments for the same practitioner (see 0004).
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    businessId: businessId(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    // No cascade: a doctor with appointments is deactivated, never deleted.
    practitionerId: uuid("practitioner_id")
      .notNull()
      .references(() => practitioners.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: appointmentStatus("status").notNull().default("booked"),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }),
    followupSentAt: timestamp("followup_sent_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: text("cancel_reason"),
    rescheduledFromId: uuid("rescheduled_from_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("appointments_business_time").on(t.businessId, t.startsAt),
    index("appointments_client").on(t.clientId, t.startsAt),
    index("appointments_practitioner_time").on(t.practitionerId, t.startsAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    businessId: businessId(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    direction: messageDirection("direction").notNull(),
    kapsoMessageId: text("kapso_message_id"),
    type: text("type").notNull(),
    body: text("body"),
    payload: jsonb("payload"),
    createdAt: createdAt(),
  },
  (t) => [index("messages_client_time").on(t.clientId, t.createdAt)],
);

export const templates = pgTable(
  "templates",
  {
    id: id(),
    businessId: businessId(),
    name: text("name").notNull(),
    language: text("language").notNull().default("es"),
    metaTemplateId: text("meta_template_id"),
    status: templateStatus("status").notNull().default("PENDING"),
    rejectedReason: text("rejected_reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("templates_name").on(t.businessId, t.name, t.language)],
);

// Kapso can deliver a webhook more than once; X-Idempotency-Key dedupes it.
export const webhookEvents = pgTable("webhook_events", {
  idempotencyKey: text("idempotency_key").primaryKey(),
  event: text("event").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Statuses that hold a slot. Keep in sync with drizzle/0004_practitioners.sql.
export const LIVE_APPOINTMENT_STATUSES = [
  "booked",
  "reminder_sent",
  "followup_sent",
  "confirmed",
] as const;

