import { DateInput } from "@/components/date-input";
import Link from "next/link";
import { requireBusinessAccess } from "@/lib/auth";
import { listClients, patientCount } from "@/lib/dashboard/appointments";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { RecordForm } from "@/components/dashboard/record-form";
import { Pagination } from "@/components/dashboard/pagination";
import { AnimatedChanges } from "@/components/dashboard/animated-changes";
import { registerPatientAction } from "../workflow-actions";

export default async function ClientsPage({ params, searchParams }: PageProps<"/app/[businessId]/clients">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessAccess(businessId);
  const query = typeof sp.q === "string" ? sp.q : "";
  const archived = sp.archived === "1";
  const sort = sp.sort === "name" ? "name" : "recent";
  const total = await patientCount(business.id, query, archived);
  const page = Math.min(Math.max(1, Math.floor(Number(sp.page) || 1)), Math.max(1, Math.ceil(total / 25)));
  const rows = await listClients(business.id, query, { archived, sort, page, pageSize: 25 });
  const base = `/app/${business.id}/clients`;
  const paramsFor = (p = page, scope = archived) => new URLSearchParams({ q: query, sort, page: String(p), ...(scope ? { archived: "1" } : {}) });
  const context = paramsFor().toString();
  return <AnimatedChanges key={context} className="dashboard-view">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="dashboard-heading">Pacientes</h2><p className="mt-1 text-sm text-muted">{total} {archived ? "expedientes archivados" : "pacientes activos"}{query && " que coinciden con la búsqueda"}</p></div><Link className="btn-primary" href={`${base}?${context}&new=1#nuevo`}>Nuevo paciente</Link></header>
    <nav className="section-tabs" aria-label="Estado de los pacientes"><Link aria-current={!archived ? "page" : undefined} href={`${base}?${paramsFor(1, false)}`}>Activos</Link><Link aria-current={archived ? "page" : undefined} href={`${base}?${paramsFor(1, true)}`}>Archivados</Link></nav>
    <form className="flex flex-wrap items-end gap-3">
      {archived && <input type="hidden" name="archived" value="1" />}
      <label className="field-label min-w-0 flex-1 basis-64">Buscar pacientes<input name="q" defaultValue={query} placeholder="Nombre o teléfono" type="search" /></label>
      <label className="field-label">Ordenar por<select name="sort" defaultValue={sort}><option value="recent">Registro más reciente</option><option value="name">Nombre A–Z</option></select></label>
      <button className="btn-secondary">Buscar</button>{query && <Link className="btn-quiet" href={`${base}?${new URLSearchParams({ sort, ...(archived ? { archived: "1" } : {}) })}`}>Limpiar búsqueda</Link>}
    </form>
    {sp.new === "1" && <section id="nuevo" className="card dashboard-card"><div className="mb-5 flex items-center justify-between"><h3 className="font-semibold">Registrar paciente</h3><Link className="btn-quiet" href={`${base}?${context}`}>Cerrar</Link></div>
      <RecordForm action={registerPatientAction.bind(null, business.id)} className="grid gap-4 sm:grid-cols-2" submitLabel="Registrar paciente">
        <label className="field-label">Nombre completo <span className="sr-only">obligatorio</span><input name="name" required autoComplete="name" /></label>
        <label className="field-label">WhatsApp (opcional)<input name="phone" type="tel" autoComplete="tel" placeholder="7000 0000" /></label>
        <label className="field-label">Fecha de nacimiento (opcional)<DateInput name="dateOfBirth"  max={new Date().toISOString().slice(0, 10)} /></label>
        <label className="field-label">Sexo (opcional)<select name="sex" defaultValue=""><option value="">Sin indicar</option><option value="female">Femenino</option><option value="male">Masculino</option></select></label>
        <p className="text-sm text-muted sm:col-span-2">Si el WhatsApp pertenece a otro paciente, se comparte el contacto; se conserva un expediente distinto para cada persona.</p>
      </RecordForm>
    </section>}
    {rows.length ? <div className="card overflow-hidden"><div className="hidden grid-cols-[minmax(0,1.5fr)_1fr_1fr] gap-4 border-b px-6 py-4 text-xs font-medium text-muted md:grid"><span>Paciente y contacto</span><span>Próxima cita</span><span>Última consulta atendida</span></div><ul className="divide-y">{rows.map(({ client, nextAppointment, lastAppointment, conversationPaused, conversationStatus, sharedNumber }) => <li key={client.id} data-live-row={client.id}><Link href={`${base}/${client.id}?back=${encodeURIComponent(context)}`} className="grid items-center gap-4 px-6 py-5 hover:bg-neutral-50 md:grid-cols-[minmax(0,1.5fr)_1fr_1fr]">
      <div className="min-w-0"><p className="font-semibold">{client.name ?? "Sin nombre"}</p><p className="mt-1 text-sm text-muted">{formatPhone(client.waPhone)}{client.dateOfBirth && ` · ${formatLocal(new Date(`${client.dateOfBirth}T12:00:00Z`), "UTC", "dd-MM-yyyy")}`}</p><div className="mt-2 flex flex-wrap gap-2">{sharedNumber && <span className="text-xs text-muted">WhatsApp compartido</span>}{client.mergedIntoId && <span className="badge">Expediente unido</span>}{conversationStatus === "needs_reply" && <span className="badge bg-amber-50 text-amber-900">Pendiente de respuesta</span>}{conversationStatus === "follow_up" && <span className="text-xs text-muted">En seguimiento</span>}{conversationPaused && <span className="text-xs text-muted">Asistente en pausa</span>}</div></div>
      <div className="text-sm"><span className="block text-xs text-muted md:hidden">Próxima cita</span>{nextAppointment ? formatLocal(nextAppointment, business.timezone, "dd-MM-yyyy, h:mm a") : "Sin próxima cita"}</div>
      <div className="text-sm text-muted"><span className="block text-xs md:hidden">Última consulta atendida</span>{lastAppointment ? formatLocal(lastAppointment, business.timezone, "dd-MM-yyyy") : "Sin consultas atendidas"}</div>
    </Link></li>)}</ul></div> : <div className="card px-6 py-12 text-center"><h3 className="font-semibold">{query ? "Ningún paciente coincide con la búsqueda" : archived ? "No hay pacientes archivados" : "Aún no hay pacientes"}</h3><p className="mt-2 text-sm text-muted">{query ? "Prueba con otro nombre o número, o limpia la búsqueda." : archived ? "Los expedientes archivados se conservan y pueden restaurarse." : "Aparecen cuando escriben por WhatsApp. También puedes registrar un paciente que llama o visita la clínica."}</p></div>}
    <Pagination page={page} pageSize={25} total={total} href={p => `${base}?${paramsFor(p)}`} />
  </AnimatedChanges>;
}
