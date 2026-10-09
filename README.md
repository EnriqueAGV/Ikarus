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

`/admin/new` creates the business, its Kapso customer, the owner's account and a setup link. Send the link to the business. When they connect their number, Kapso calls `/api/webhooks/kapso/project` (and redirects them to `/onboarding/success`); Ikarus then registers the number's message webhook and submits the three Spanish reminder templates to Meta for review.

## Reminders

Every booking starts the `appointment-reminders` Inngest function. At the business's lead time before the appointment (24 hours by default) it sends the `ikarus_recordatorio` template with Confirmar, Reprogramar and Cancelar buttons. With no reply after 2 hours it sends `ikarus_seguimiento`; with no reply 2 hours after that it cancels the appointment and sends `ikarus_cita_cancelada`. Any message from the client stops the flow, and tapping Confirmar marks the appointment confirmed. Cancelling or rescheduling stops it too. Bookings made inside the lead time get no reminder, and nothing is sent until Meta has approved the template.

## The business dashboard

Owners and staff sign in at `/login` and land on `/app/<business>`:

- **Citas**: day, week and upcoming views. Staff can cancel an upcoming appointment (this frees the slot and stops its reminders) and mark past ones as attended or no-show.
- **Clientes**: everyone who has written, their intake answers, appointments and conversation. When the agent hands a client to the business it pauses for that client; staff can reply from the page (within WhatsApp's 24-hour window) and resume the agent.
- **Ajustes** (owners): services, weekly hours, closed days, the questions the agent asks, the reminder lead time and notes for the agent. The agent only books once there is an active service and opening hours.
- **Equipo** (owners): invite owners or staff by email; they sign in with a magic link.

## Layout

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | All tables; every business-owned row has `business_id` |
| `drizzle/` | Migrations; `0001` adds the exclusion constraint that blocks overlapping appointments |
| `src/lib/auth.ts` | `requireSuperAdmin`, `requireBusinessAccess` |
| `src/proxy.ts` | Refreshes the Supabase session, guards `/admin` and `/app` |
| `src/lib/kapso/` | Kapso API client, webhook verification, template definitions |
| `src/lib/onboarding.ts` | Business creation, setup links, connecting a number |
| `src/lib/booking/` | Free-slot engine and booking, cancel, reschedule |
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

Integration tests need a disposable, migrated Postgres at `DATABASE_URL` (default `postgres://ikarus:ikarus@localhost:5432/ikarus_test`). Kapso is replaced by a local fake server.
