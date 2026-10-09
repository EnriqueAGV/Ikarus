import {
  type AnyPgColumn,
  boolean,
  customType,
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
import { sql } from "drizzle-orm";
import { decrypt, encrypt } from "../lib/crypto";

const id = () => uuid("id").primaryKey().defaultRandom();

// Sensitive columns are AES-256-GCM encrypted by the app (src/lib/crypto.ts).
// They are text in Postgres and can't be filtered or searched in SQL.
const encryptedText = (name: string, context: string) =>
  customType<{ data: string; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => encrypt(value, context),
    fromDriver: (value) => decrypt(value, context),
  })(name);
const encryptedJson = <T>(name: string, context: string) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    toDriver: (value) => encrypt(JSON.stringify(value), context),
    fromDriver: (value) => JSON.parse(decrypt(value, context)) as T,
  })(name);
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const businessId = () =>
  uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" });

// A clinic has doctors and assistants; manages_clinic on the membership is the
// separate permission to edit settings and invite people.
export const memberRole = pgEnum("member_role", ["doctor", "assistant"]);
export const patientSex = pgEnum("patient_sex", ["female", "male"]);
export const accessAction = pgEnum("access_action", [
  "view_chart",
  "edit_chart",
  "edit_clinical",
  "create_note",
  "sign_note",
  "add_addendum",
  "print_note",
]);
export const noteStatus = pgEnum("note_status", ["draft", "signed"]);
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
// What happens when a patient never answers the reminder and its follow-up.
export const reminderEndPolicy = pgEnum("reminder_end_policy", ["escalate", "auto_cancel"]);
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
    timezone: text("timezone").notNull().default("America/El_Salvador"),
    locale: text("locale").notNull().default("es"),
    status: businessStatus("status").notNull().default("invited"),
    kapsoCustomerId: text("kapso_customer_id").unique(),
    phoneNumberId: text("phone_number_id").unique(),
    wabaId: text("waba_id"),
    kapsoMessageWebhookId: text("kapso_message_webhook_id"),
    displayPhone: text("display_phone"),
    reminderLeadHours: smallint("reminder_lead_hours").notNull().default(24),
    // escalate: the appointment stays booked and is flagged for the team to call.
    reminderEndPolicy: reminderEndPolicy("reminder_end_policy").notNull().default("escalate"),
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
    role: memberRole("role").notNull().default("assistant"),
    managesClinic: boolean("manages_clinic").notNull().default(false),
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
    // E.164 without "+", as WhatsApp sends it. Null for a patient the clinic
    // registered without WhatsApp.
    waPhone: text("wa_phone"),
    // Several patients can share one WhatsApp number (a mother and her son).
    // The number's conversation, consent and agent pause live on its holder,
    // the patient without holder_id; the others point to it.
    holderId: uuid("holder_id").references((): AnyPgColumn => clients.id, { onDelete: "restrict" }),
    name: text("name"),
    data: encryptedJson<Record<string, unknown>>("data", "clients.data")
      .notNull()
      .$defaultFn(() => ({})),
    agentPaused: boolean("agent_paused").notNull().default(false),
    // The record header. Patients belong to the clinic, so a patient seen by
    // two doctors has one record.
    dateOfBirth: date("date_of_birth"),
    sex: patientSex("sex"),
    dui: encryptedText("dui", "clients.dui"),
    address: text("address"),
    guardianName: text("guardian_name"),
    guardianPhone: text("guardian_phone"),
    emergencyContactName: text("emergency_contact_name"),
    emergencyContactPhone: text("emergency_contact_phone"),
    // Doctors only (can(member, "chart.clinical")).
    allergies: encryptedText("allergies", "clients.allergies"),
    chronicConditions: encryptedText("chronic_conditions", "clients.chronic_conditions"),
    preferredPractitionerId: uuid("preferred_practitioner_id").references(() => practitioners.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("clients_phone_holder")
      .on(t.businessId, t.waPhone)
      .where(sql`${t.holderId} is null and ${t.waPhone} is not null`),
    index("clients_phone").on(t.businessId, t.waPhone),
    index("clients_holder").on(t.holderId),
  ],
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
    // Set when the patient never answered and the clinic should call them.
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
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
    body: encryptedText("body", "messages.body"),
    payload: encryptedJson<unknown>("payload", "messages.payload"),
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

// Who looked at or changed which patient's record, and when. Rows are never
// deleted, so neither the clinic nor the patient can be while any exist.
export const accessLog = pgTable(
  "access_log",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    practitionerId: uuid("practitioner_id").references(() => practitioners.id, { onDelete: "restrict" }),
    action: accessAction("action").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("access_log_client_time").on(t.clientId, t.createdAt)],
);

// A patient's acceptance of a version of the privacy notice, with the
// WhatsApp message that accepted it. Health data needs express consent.
export const consents = pgTable(
  "consents",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    noticeVersion: text("notice_version").notNull(),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("consents_client_version").on(t.clientId, t.noticeVersion)],
);

export type Vitals = {
  bloodPressure?: string; // "120/80" mmHg
  heartRate?: number; // bpm
  temperature?: number; // °C
  weight?: number; // kg
  height?: number; // cm
  spo2?: number; // %
};

// A SOAP note in the patient's expediente. A draft can be edited by its
// doctor; signing numbers it (per patient, since the record is shared by the
// clinic) and locks it. drizzle/0007 has the trigger that rejects any change
// to a signed note, so even a bug can't alter one (Art. 42 g).
export const clinicalNotes = pgTable(
  "clinical_notes",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    practitionerId: uuid("practitioner_id")
      .notNull()
      .references(() => practitioners.id, { onDelete: "restrict" }),
    appointmentId: uuid("appointment_id").references(() => appointments.id, { onDelete: "restrict" }),
    // Set by the database when the note is signed.
    number: integer("number"),
    subjective: encryptedText("subjective", "clinical_notes.subjective"),
    objective: encryptedText("objective", "clinical_notes.objective"),
    vitals: encryptedJson<Vitals>("vitals", "clinical_notes.vitals"),
    assessment: encryptedText("assessment", "clinical_notes.assessment"),
    // CIE-10 codes stay in the clear so diagnoses can be searched.
    diagnosisCodes: text("diagnosis_codes").array().notNull().default([]),
    plan: encryptedText("plan", "clinical_notes.plan"),
    status: noteStatus("status").notNull().default("draft"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signedBy: uuid("signed_by").references(() => profiles.id, { onDelete: "restrict" }),
    // SHA-256 of the signed content (see src/lib/notes.ts).
    contentHash: text("content_hash"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("clinical_notes_number").on(t.clientId, t.number),
    index("clinical_notes_client_time").on(t.clientId, t.createdAt),
  ],
);

// A dated correction or addition to a signed note, by any doctor in the
// clinic. Addenda can't be changed or deleted either.
export const noteAddenda = pgTable(
  "note_addenda",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    noteId: uuid("note_id")
      .notNull()
      .references(() => clinicalNotes.id, { onDelete: "restrict" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    practitionerId: uuid("practitioner_id").references(() => practitioners.id, { onDelete: "restrict" }),
    body: encryptedText("body", "note_addenda.body").notNull(),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("note_addenda_note").on(t.noteId, t.createdAt)],
);

// Browsers where a doctor or clinic manager confirmed a code sent to their
// email. Only a hash of the cookie's token is kept; deleting the rows makes
// every one of their devices ask for a code again.
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trusted_devices_token").on(t.tokenHash), index("trusted_devices_user").on(t.userId)],
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

