import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireBusinessAccess } from "@/lib/auth";
import { todayIn } from "@/lib/dashboard/appointments";
import { formatLocal } from "@/lib/dashboard/labels";
import { isMonth, monthNumbers, shiftMonth } from "@/lib/dashboard/stats";

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)} %`);

function Delta({ now, before }: { now: number; before: number }) {
  if (now === before) return <span className="text-xs text-neutral-400">igual que el mes anterior</span>;
  const up = now > before;
  return (
    <span className="text-xs text-neutral-500">
      {up ? "▲" : "▼"} {Math.abs(now - before)} vs. mes anterior
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border p-4">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint}
    </div>
  );
}

// A month at the clinic, for its managers.
export default async function StatsPage({ params, searchParams }: PageProps<"/app/[businessId]/stats">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "clinic.manage")) notFound();
  const { business } = membership;
  const current = todayIn(business.timezone).slice(0, 7);
  const month = typeof sp.month === "string" && isMonth(sp.month) ? sp.month : current;
  const [m, prev] = await Promise.all([monthNumbers(business, month), monthNumbers(business, shiftMonth(month, -1))]);
  const title = formatLocal(new Date(`${month}-15T12:00:00Z`), "UTC", "MMMM yyyy");
  const href = (mm: string) => `/app/${business.id}/stats?month=${mm}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Link href={href(shiftMonth(month, -1))} className="rounded-md border px-2 py-1 text-sm" aria-label="Mes anterior">
          ←
        </Link>
        {month < current ? (
          <Link href={href(shiftMonth(month, 1))} className="rounded-md border px-2 py-1 text-sm" aria-label="Mes siguiente">
            →
          </Link>
        ) : (
          <span className="rounded-md border px-2 py-1 text-sm text-neutral-300">→</span>
        )}
        <h2 className="ml-2 text-lg font-medium capitalize">{title}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Citas del mes" value={m.appointments} hint={<Delta now={m.appointments} before={prev.appointments} />} />
        <Stat label="Atendidas" value={m.completed} hint={<Delta now={m.completed} before={prev.completed} />} />
        <Stat label="No asistieron" value={m.noShows} hint={<span className="text-xs text-neutral-500">{pct(m.noShowRate)} de las citas con resultado</span>} />
        <Stat label="Canceladas" value={m.cancelled} hint={<Delta now={m.cancelled} before={prev.cancelled} />} />
        <Stat
          label="Agendadas por el asistente"
          value={m.booked.byAssistant}
          hint={<span className="text-xs text-neutral-500">{m.booked.byStaff} por el equipo en el panel</span>}
        />
        <Stat label="Pacientes nuevos" value={m.newPatients} hint={<Delta now={m.newPatients} before={prev.newPatients} />} />
        <Stat label="Conversaciones por WhatsApp" value={m.conversations} hint={<span className="text-xs text-neutral-500">{m.received} mensajes recibidos</span>} />
      </div>

      {m.byDoctor.length > 1 && (
        <section className="flex flex-col gap-2">
          <h3 className="font-medium">Por doctor</h3>
          <table className="w-full max-w-xl text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pb-1 font-normal">Doctor</th>
                <th className="pb-1 text-right font-normal">Citas</th>
                <th className="pb-1 text-right font-normal">Atendidas</th>
                <th className="pb-1 text-right font-normal">No asistieron</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {m.byDoctor.map((d) => (
                <tr key={d.practitionerId}>
                  <td className="py-1.5">{d.name}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.appointments}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.completed}</td>
                  <td className="py-1.5 text-right tabular-nums">{d.noShows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <p className="text-xs text-neutral-500">
        Las citas cuentan por el día en que son; las reprogramadas, una sola vez. &ldquo;Agendadas&rdquo; cuenta las citas creadas este mes,
        desde que el panel empezó a registrar quién agenda.
      </p>
    </div>
  );
}
