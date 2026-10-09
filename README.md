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

Accounts are invite-only (`shouldCreateUser: false`). To make the first super-admin, invite yourself from the Supabase dashboard, sign in once, then:

```sql
update profiles set is_super_admin = true where email = 'you@example.com';
```

## Layout

| Path | What it is |
| --- | --- |
| `src/db/schema.ts` | All tables; every business-owned row has `business_id` |
| `drizzle/` | Migrations; `0001` adds the exclusion constraint that blocks overlapping appointments |
| `src/lib/auth.ts` | `requireSuperAdmin`, `requireBusinessAccess` |
| `src/proxy.ts` | Refreshes the Supabase session, guards `/admin` and `/app` |
| `src/lib/kapso/` | Kapso helpers (webhook signature check) |
| `src/inngest/` | Durable reminder flows |

## Checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
```
