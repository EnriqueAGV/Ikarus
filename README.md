# Ikarus

Agenda por WhatsApp para negocios: un agente atiende a los clientes, recoge sus datos y les reserva un horario. Los recordatorios, el seguimiento a las 2 horas y la cancelación automática a las 4 horas corren solos.

Built on Next.js 16, Postgres (Supabase), Drizzle, Inngest, Claude and Kapso. The full plan lives in the "Ikarus MVP plan" doc.

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

## Layout

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | All tables; every business-owned row has `business_id` |
| `drizzle/` | Migrations; `0001` adds the exclusion constraint that blocks overlapping appointments |
| `src/lib/auth.ts` | `requireSuperAdmin`, `requireBusinessAccess` |
| `src/proxy.ts` | Refreshes the Supabase session, guards `/admin` and `/app` |
| `src/lib/kapso/` | Kapso API client, webhook verification, template definitions |
| `src/lib/onboarding.ts` | Business creation, setup links, connecting a number |
| `src/inngest/` | Durable reminder flows |

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Integration tests need a disposable, migrated Postgres at `DATABASE_URL` (default `postgres://ikarus:ikarus@localhost:5432/ikarus_test`). Kapso is replaced by a local fake server.
