# Ikarus

Agenda por WhatsApp para negocios: un agente atiende a los clientes, recoge sus datos y les reserva un horario. Los recordatorios, el seguimiento a las 2 horas y la cancelación automática a las 4 horas corren solos.

Built on Next.js 16, Postgres (Supabase), Drizzle, Inngest, Kapso and any OpenAI-compatible LLM endpoint. The full plan lives in the "Ikarus MVP plan" doc.

## Local setup

```bash
cp .env.example .env.local   # fill in DATABASE_URL and the Supabase keys
npm install
npm run db:migrate           # creates tables and the no-double-booking constraint
npm run dev                  # http://localhost:3000
npm run inngest:dev          # in a second terminal: local Inngest dev server
```

Accounts are created by a super-admin when they add a business. Emails listed in `SUPER_ADMIN_EMAILS` can sign in without an account and become super-admins.

## Deploying on Vercel

Import the repo in Vercel and set every variable from `.env.example` under Settings → Environment Variables. The build runs `npm run db:migrate` first (see `vercel.json`), so the Supabase tables are created on each deploy.

After the first deploy:

1. Set `APP_URL` to the deployment URL and redeploy.
2. In Supabase → Authentication → URL Configuration, set the Site URL to `APP_URL` and add `APP_URL/auth/callback` to the redirect URLs.
3. Sign in at `/login` with a `SUPER_ADMIN_EMAILS` address, then click "Registrar webhook de Kapso" at the bottom of `/admin`.

## Onboarding a business

`/admin/new` creates the business, its Kapso customer, the first doctor's account (a doctor who manages the clinic, with their own calendar) (Supabase emails them an invitation that opens their dashboard through `/auth/invite`) and a setup link. Send the link to the business. When they connect their number, Kapso calls `/api/webhooks/kapso/project` (and redirects them to `/onboarding/success`); Ikarus then registers the number's message webhook and submits the five Spanish templates to Meta for review. For a clinic connected before a template was added, "Crear faltantes y actualizar estado" on its admin page submits the missing ones.

## Reminders

Every booking starts the `appointment-reminders` Inngest function. At the clinic's lead time before the appointment (24 hours by default) it sends the `praxia_recordatorio` template with Confirmar, Reprogramar and Cancelar buttons. With no reply after 2 hours it sends a follow-up. With no reply 2 hours after that, the clinic's setting decides: by default the appointment stays booked, shows "Sin confirmar, llamar" in the agenda and is listed at the top of Citas for the team to call (`praxia_seguimiento`); with auto-cancel, the follow-up warns about it (`praxia_seguimiento_aviso`), then the appointment is cancelled and the patient gets `praxia_cita_cancelada`. Templates name the clinic, the doctor and the time only, never the service or reason. Any message from the patient stops the flow, and tapping Confirmar marks the appointment confirmed. Cancelling or rescheduling stops it too. Bookings made inside the lead time get no reminder, and nothing is sent until Meta has approved the template.

While the agent prepares a reply, the patient sees "escribiendo…" (WhatsApp's typing indicator, which also marks their message as read).

After the privacy notice, the assistant first asks a new patient for their full name and DUI (stored encrypted, never repeated back). It won't book an adult without a DUI; a minor, by birth date, needs none, and an adult without one is handed to the team. It then offers the earliest free times over the next days instead of asking when they'd like to come.

Messages that describe an emergency (chest pain, trouble breathing, fainting, bleeding and similar, see `src/lib/agent/emergency.ts`) never reach the LLM: the patient gets a fixed reply pointing to 911 and Cruz Roja (132), and the conversation is handed to the team.

Before the agent handles anything else, a new patient gets a button message linking to the clinic's privacy notice (`/privacidad/<business>`, a draft until a lawyer reviews it). The agent waits until they tap Acepto or write ACEPTO; the acceptance is stored in `consents` with the message and the notice version (`NOTICE_VERSION` in `src/lib/agent/consent.ts`; changing it asks everyone again). Emergencies are answered before consent.

## The business dashboard

Doctors and assistants sign in at `/login` and land on `/app/<business>`. The first time a doctor, a clinic manager or a super-admin signs in on a new computer or phone, `/auth/device` emails them a one-time code (Supabase email OTP); once they type it, that browser is remembered (a cookie whose hash is in `trusted_devices`) and isn't asked again. "Olvidar dispositivos" in Equipo makes all of someone's devices ask again, for a lost phone. The code reaches people only if Supabase's Magic Link email template includes `{{ .Token }}`. Every permission check goes through `can()` in `src/lib/permissions.ts`.

- **Citas**: day, week and upcoming views. The team can confirm an appointment by phone, cancel an upcoming one (this frees the slot and stops its reminders) and mark past ones as attended or no-show. Nueva cita (also Agendar cita on a patient's page) books a patient who called or walked in into a free time, with any doctor or a chosen one; Mover moves an upcoming appointment to another free time, keeping the original if the new one was just taken. Both can tell the patient on WhatsApp with `praxia_cita_agendada` (on by default; skipped, with a note in the agenda, when the patient has no WhatsApp or Meta hasn't approved the template), and reminders follow as for any booking. The day view lists and adds blocked hours on a doctor's calendar (`time_blocks`): they are never offered, by the agent or here, while appointments already in them stay.
- **Pacientes**: everyone who has written, plus patients the team registers with Nuevo paciente (name required; WhatsApp, birth date and sex optional). A patient's page has their record (name, birth date, sex, DUI, address, guardian, emergency contact, preferred doctor), their WhatsApp intake answers, appointments and conversation. Allergies and chronic conditions are shown to doctors only, and so are the clinical notes and the access log: who opened, edited, signed or printed the record, and when. When the agent hands a patient to the clinic it pauses for them; the team can reply from the page (within WhatsApp's 24-hour window) and resume the agent. Several patients can share one WhatsApp number, such as a mother and her children: the agent asks who each appointment is for and adds new people to the number (`add_patient`), and a patient registered by hand with a number already in use joins it. The number's first patient holds the conversation, consent and agent pause (`holder_id` is null for them and points to them for the rest, see `src/lib/household.ts`); reminders and staff replies about anyone on the number go there. A patient without WhatsApp gets no messages or reminders. Archivar paciente hides a patient from Pacientes, search and the assistant and cancels their upcoming appointments; the record and access log stay, Ver archivados lists them with Restaurar, and a number's holder who writes again comes back by themselves.
- **Ajustes** (members who manage the clinic): doctors, each doctor's weekly hours and days off, services, the questions the agent asks, the reminder lead time and notes for the agent. The agent only books once there is an active doctor with hours and an active service. A new service is offered by every active doctor, and a new doctor offers every active service.
- **Equipo** (members who manage the clinic): invite doctors or assistants by email and choose who manages the clinic. Inviting a doctor also creates their calendar. A clinic always keeps at least one manager, and a doctor who leaves keeps their calendar, inactive.

## Clinical notes

Doctors write SOAP notes from a patient's page (Nueva nota) or from today's appointments in Citas (Iniciar consulta). A draft has the four sections, vitals and CIE-10 diagnoses (searched by code or words, from `src/lib/cie10/catalogue.json`), saves itself while the doctor types, and only its own doctor can edit, discard or sign it. Signing gives the note the patient's next number and locks it: the trigger in `drizzle/0007_clinical_notes.sql` rejects any change or deletion of a signed note, even from code that skips the app's checks. Corrections go in addenda, which any doctor in the clinic can add and nobody can change. Each signature stores a SHA-256 hash of the content, and the note page says whether the content still matches it. "Imprimir o PDF" opens the patient's copy with the doctor's header, JVPM number and note number; the browser's print dialog saves it as PDF.

## Encryption

Note text, vitals, addenda, the DUI, allergies, chronic conditions, intake answers and WhatsApp messages are encrypted by the app with AES-256-GCM before they reach the database (`src/lib/crypto.ts`, applied through the column types in `src/db/schema.ts`). Names, phone numbers, birth dates and CIE-10 codes stay in the clear so they can be searched. Set `DATA_ENCRYPTION_KEYS` to `1:<key>` with a key from `openssl rand -base64 32`, in every environment that touches the database, and keep a copy somewhere safe: without it the encrypted data can't be read. To rotate, add `2:<new key>` (keeping `1:`), redeploy and click "Cifrar datos existentes" in `/admin`; the same button encrypts rows saved before encryption existed.

## Layout

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | All tables; every business-owned row has `business_id` |
| `drizzle/` | Migrations; `0004` moves calendars to practitioners and makes the exclusion constraint block overlapping appointments per doctor; `0006` adds doctor and assistant roles, the patient record fields, the access log and consents; `0007` adds clinical notes and addenda with the triggers that lock them; `0008` adds trusted devices; `0009` lets several patients share a WhatsApp number; `0010` adds blocked hours; `0011` lets patients be archived |
| `src/lib/auth.ts`, `src/lib/permissions.ts` | `requireSuperAdmin`, `requireBusinessAccess` (with the new-device code) and the permission table `can()` |
| `src/proxy.ts` | Refreshes the Supabase session, guards `/admin` and `/app` |
| `src/lib/kapso/` | Kapso API client, webhook verification, template definitions |
| `src/lib/onboarding.ts` | Business creation, setup links, connecting a number |
| `src/lib/booking/` | Practitioners (doctors), the free-slot engine and booking, cancel, reschedule |
| `src/lib/agent/` | The WhatsApp booking agent (LLM + tools, `src/lib/agent/llm.ts` is the endpoint client) |
| `src/lib/dashboard/` | Settings, calendar queries and team management behind the dashboard |
| `src/app/app/[businessId]/` | Dashboard pages and their server actions |
| `src/inngest/` | Background work: agent replies, reminder flows |

## How a client message is answered

Kapso posts the message to `/api/webhooks/kapso/messages`. Ikarus stores it (creating the client on first contact) and sends an Inngest event. The `agent-reply` function runs one conversation at a time per client: it loads the business's services, opening hours, intake questions and the last 30 messages, and lets the model set in `LLM_MODEL` (served at `LLM_BASE_URL`) answer using the tools in `src/lib/agent/tools.ts`. Bookings only happen through those tools, which re-check the calendar inside a transaction; the database's exclusion constraint is the last guard against double booking.

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Integration tests need a disposable, migrated Postgres at `DATABASE_URL` (default `postgres://ikarus:ikarus@localhost:5432/ikarus_test`). Kapso is replaced by a local fake server. `.github/workflows/ci.yml` runs all of this on every pull request and push to `main`, against a throwaway Postgres service.

Every response carries HSTS (two years), `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy (`next.config.ts`). Database connections require TLS outside localhost (`src/db/tls.ts`).
