import Link from "next/link";
import { requireBusinessManager } from "@/lib/auth";
import { bankDetails, formatMoney, invoicesFor, standing, transferReference } from "@/lib/billing";
import { standingLabel } from "@/lib/billing-labels";
import { listPractitioners } from "@/lib/booking/practitioners";
import { todayIn } from "@/lib/dashboard/appointments";
import { formatLocal, settingsErrorLabel, weekdayLabel } from "@/lib/dashboard/labels";
import { getExceptions, getWeeklyRules, listIntakeFields, listServices } from "@/lib/dashboard/settings";
import { mapsLink } from "@/lib/location";
import {
  addExceptionAction,
  addPractitionerAction,
  createIntakeAction,
  createServiceAction,
  deleteIntakeAction,
  moveIntakeAction,
  removeExceptionAction,
  saveGeneralAction,
  saveHoursAction,
  updateIntakeAction,
  updatePractitionerAction,
  updateServiceAction,
} from "../actions";

const input = "rounded-xl border px-2 py-1.5 text-sm";
const button = "rounded-full border px-4 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 bg-white";
const primary = "rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm";
const hhmm = (t: string | null) => t?.slice(0, 5) ?? "";
// Monday first, as the week view shows it.
const WEEK = [1, 2, 3, 4, 5, 6, 0];
const typeLabel = { text: "Texto", date: "Fecha", choice: "Opciones" } as const;

export default async function SettingsPage({ params, searchParams }: PageProps<"/app/[businessId]/settings">) {
  const { businessId } = await params;
  const sp = await searchParams;
  const { business } = await requireBusinessManager(businessId);
  const id = business.id;
  const practitioners = await listPractitioners(id);
  const billing = standing(business);
  const invoices = await invoicesFor(id);
  const pendingInvoices = invoices.filter((i) => i.status === "pending");
  const paidInvoices = invoices.filter((i) => i.status === "paid");
  const bank = bankDetails();
  // Hours and days off are per doctor; the picker only shows with two or more.
  const doctor =
    practitioners.find((p) => p.id === sp.doctor) ?? practitioners.find((p) => p.active) ?? practitioners[0] ?? null;
  const [rules, exceptions, services, fields] = await Promise.all([
    doctor ? getWeeklyRules(id, doctor.id) : [],
    doctor ? getExceptions(id, doctor.id, todayIn(business.timezone)) : [],
    listServices(id),
    listIntakeFields(id),
  ]);
  const anyActive = practitioners.some((p) => p.active);
  const error = typeof sp.error === "string" ? settingsErrorLabel[sp.error] ?? "No se pudo guardar." : null;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      {error && <p className="notice notice-error text-sm">{error}</p>}
      {sp.saved && <p className="notice notice-ok text-sm">Cambios guardados.</p>}
      {(services.filter((s) => s.active).length === 0 || rules.length === 0 || !anyActive) && (
        <p className="notice notice-warn text-sm">
          El asistente solo puede agendar cuando hay al menos un doctor activo con horario de atención y un servicio activo.
        </p>
      )}

      <section id="doctors" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Doctores</h2>
        <ul className="flex flex-col gap-2">
          {practitioners.map((p) => (
            <li key={p.id}>
              <form action={updatePractitionerAction.bind(null, id, p.id)} className="card flex flex-wrap items-end gap-2 p-4">
                <PractitionerInputs displayName={p.displayName} specialty={p.specialty} jvpmNumber={p.jvpmNumber} />
                <label className="flex items-center gap-1 pb-1.5 text-sm">
                  <input type="checkbox" name="active" defaultChecked={p.active} /> Activo
                </label>
                <button className={button}>Guardar</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addPractitionerAction.bind(null, id)} className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-4">
          <PractitionerInputs displayName="" specialty={null} jvpmNumber={null} />
          <button className={primary}>Agregar doctor</button>
        </form>
        <p className="text-xs text-neutral-500">
          Cada doctor tiene su propio horario y sus días libres. Un doctor nuevo ofrece todos los servicios activos.
        </p>
      </section>

      <section id="services" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Servicios</h2>
        <ul className="flex flex-col gap-2">
          {services.map((s) => (
            <li key={s.id}>
              <form action={updateServiceAction.bind(null, id, s.id)} className="card flex flex-wrap items-end gap-2 p-4">
                <Field label="Nombre">
                  <input name="name" defaultValue={s.name} required className={`${input} w-56`} />
                </Field>
                <Field label="Duración (min)">
                  <input name="durationMin" type="number" min={5} max={720} defaultValue={s.durationMin} className={`${input} w-24`} />
                </Field>
                <Field label="Margen después (min)">
                  <input name="bufferMin" type="number" min={0} max={240} defaultValue={s.bufferMin} className={`${input} w-24`} />
                </Field>
                <label className="flex items-center gap-1 pb-1.5 text-sm">
                  <input type="checkbox" name="active" defaultChecked={s.active} /> Activo
                </label>
                <button className={button}>Guardar</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={createServiceAction.bind(null, id)} className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-4">
          <Field label="Nuevo servicio">
            <input name="name" required placeholder="Consulta general" className={`${input} w-56`} />
          </Field>
          <Field label="Duración (min)">
            <input name="durationMin" type="number" min={5} max={720} defaultValue={60} className={`${input} w-24`} />
          </Field>
          <Field label="Margen después (min)">
            <input name="bufferMin" type="number" min={0} max={240} defaultValue={0} className={`${input} w-24`} />
          </Field>
          <button className={primary}>Agregar</button>
        </form>
      </section>

      {doctor && practitioners.length > 1 && (
        <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Doctor">
          <span className="text-neutral-500">Horario de</span>
          <div className="flex flex-wrap gap-1 rounded-full bg-black/[0.05] p-1">
          {practitioners.map((p) => (
            <Link
              key={p.id}
              href={`/app/${id}/settings?doctor=${p.id}#hours`}
              className={`rounded-full px-3.5 py-1 ${p.id === doctor.id ? "bg-white font-medium text-foreground shadow-sm" : "text-neutral-600 hover:text-foreground"} ${p.active ? "" : "opacity-60"}`}
            >
              {p.displayName}
            </Link>
          ))}
          </div>
        </nav>
      )}

      {doctor && (
      <section id="hours" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Horario de atención{practitioners.length > 1 ? ` · ${doctor.displayName}` : ""}</h2>
        <p className="text-sm text-neutral-500">
          Hora local ({business.timezone}). Usa el segundo horario para días con pausa, por ejemplo 9:00–14:00 y 16:00–19:00.
        </p>
        <form action={saveHoursAction.bind(null, id, doctor.id)} className="card flex flex-col gap-2 p-4">
          {WEEK.map((d) => {
            const day = rules.filter((r) => r.weekday === d);
            return (
              <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                <label className="flex w-28 items-center gap-2">
                  <input type="checkbox" name={`d${d}_open`} defaultChecked={day.length > 0} />
                  {weekdayLabel[d]}
                </label>
                {[1, 2].map((n) => (
                  <span key={n} className="flex items-center gap-1">
                    <input type="time" name={`d${d}_s${n}`} defaultValue={hhmm(day[n - 1]?.startTime ?? (n === 1 ? "09:00" : null))} className={input} />
                    –
                    <input type="time" name={`d${d}_e${n}`} defaultValue={hhmm(day[n - 1]?.endTime ?? (n === 1 ? "18:00" : null))} className={input} />
                  </span>
                ))}
              </div>
            );
          })}
          <div>
            <button className={primary}>Guardar horario</button>
          </div>
        </form>
      </section>
      )}

      {doctor && (
      <section id="exceptions" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Días especiales{practitioners.length > 1 ? ` · ${doctor.displayName}` : ""}</h2>
        <p className="text-sm text-neutral-500">Días cerrados o con otro horario. Reemplazan el horario semanal ese día.</p>
        {exceptions.length > 0 && (
          <ul className="card divide-y text-sm overflow-hidden">
            {exceptions.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  <span className="inline-block first-letter:uppercase">{formatLocal(new Date(`${e.date}T12:00:00Z`), "UTC", "EEEE d 'de' MMMM yyyy")}</span>
                  {" · "}
                  {e.startTime ? `${hhmm(e.startTime)}–${hhmm(e.endTime)}` : "Cerrado"}
                  {e.note ? ` · ${e.note}` : ""}
                </span>
                <form action={removeExceptionAction.bind(null, id, doctor.id, e.id)}>
                  <button className="text-xs text-neutral-500 hover:underline">Quitar</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addExceptionAction.bind(null, id, doctor.id)} className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-4">
          <Field label="Fecha">
            <input type="date" name="date" required className={input} />
          </Field>
          <label className="flex items-center gap-1 pb-1.5 text-sm">
            <input type="checkbox" name="closed" defaultChecked /> Cerrado
          </label>
          <Field label="o abre de">
            <span className="flex items-center gap-1">
              <input type="time" name="startTime" className={input} />–<input type="time" name="endTime" className={input} />
            </span>
          </Field>
          <Field label="Nota">
            <input name="note" placeholder="Día festivo" className={`${input} w-40`} />
          </Field>
          <button className={primary}>Agregar</button>
        </form>
      </section>
      )}

      <section id="intake" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Datos que pide el asistente</h2>
        <p className="text-sm text-neutral-500">
          El nombre siempre se pide. El asistente no agenda hasta tener los datos obligatorios.
        </p>
        <ul className="flex flex-col gap-2">
          {fields.map((f, i) => (
            <li key={f.id} className="card flex flex-wrap items-end gap-2 p-4">
              <form action={updateIntakeAction.bind(null, id, f.id)} className="flex flex-wrap items-end gap-2">
                <IntakeInputs label={f.label} type={f.type} options={f.options ?? []} required={f.required} />
                <button className={button}>Guardar</button>
              </form>
              <div className="flex gap-1">
                <form action={moveIntakeAction.bind(null, id, f.id, "up")}>
                  <button disabled={i === 0} className={`${button} disabled:opacity-30`} aria-label="Subir">↑</button>
                </form>
                <form action={moveIntakeAction.bind(null, id, f.id, "down")}>
                  <button disabled={i === fields.length - 1} className={`${button} disabled:opacity-30`} aria-label="Bajar">↓</button>
                </form>
                <form action={deleteIntakeAction.bind(null, id, f.id)}>
                  <button className={`${button} text-red-700 dark:text-red-400`}>Quitar</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
        <form action={createIntakeAction.bind(null, id)} className="flex flex-wrap items-end gap-2 rounded-2xl border border-dashed p-4">
          <IntakeInputs label="" type="text" options={[]} required />
          <button className={primary}>Agregar</button>
        </form>
      </section>

      <section id="general" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Recordatorios y asistente</h2>
        <form action={saveGeneralAction.bind(null, id)} className="card flex flex-col gap-3 p-4">
          <Field label="Enviar el recordatorio cuántas horas antes de la cita">
            <input
              name="reminderLeadHours"
              type="number"
              min={1}
              max={168}
              defaultValue={business.reminderLeadHours}
              className={`${input} w-24`}
            />
          </Field>
          <fieldset className="flex flex-col gap-1 text-sm">
            <legend className="mb-1 text-xs text-neutral-500">
              Si el paciente no responde, se envía un seguimiento a las 2 horas. Si 2 horas después sigue sin responder:
            </legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="reminderEndPolicy" value="escalate" defaultChecked={business.reminderEndPolicy === "escalate"} />
              La cita se mantiene y se marca &ldquo;Sin confirmar, llamar&rdquo; para que el equipo llame al paciente
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="reminderEndPolicy" value="auto_cancel" defaultChecked={business.reminderEndPolicy === "auto_cancel"} />
              La cita se cancela sola y se le avisa al paciente
            </label>
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="noShowFollowUp" defaultChecked={business.noShowFollowUp} />
            Cuando un paciente no asiste, enviarle un WhatsApp ofreciéndole una nueva cita
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Ubicación en Google Maps (opcional)">
              <input
                name="mapsUrl"
                defaultValue={business.mapsUrl ?? ""}
                placeholder="https://maps.app.goo.gl/…"
                className={`${input} w-full`}
              />
              <span>
                En Google Maps, busca el consultorio, toca Compartir y pega aquí el enlace. El asistente envía la ubicación al
                agendar una cita y cuando le preguntan cómo llegar.
                {business.locationLat !== null && business.locationLng !== null && (
                  <>
                    {" "}
                    <a href={mapsLink({ lat: business.locationLat, lng: business.locationLng })} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                      Ver la ubicación guardada
                    </a>
                  </>
                )}
              </span>
            </Field>
            <Field label="Dirección que se muestra con la ubicación">
              <input
                name="locationAddress"
                maxLength={200}
                defaultValue={business.locationAddress ?? ""}
                placeholder="Paseo General Escalón 123, San Salvador"
                className={`${input} w-full`}
              />
            </Field>
          </div>
          <Field label="Información del consultorio para el asistente (opcional)">
            <textarea
              name="faq"
              rows={6}
              maxLength={4000}
              defaultValue={business.faq ?? ""}
              placeholder={"Dirección: Paseo General Escalón 123, Colonia Escalón, San Salvador.\nParqueo: frente a la clínica, gratis.\nConsulta general: $30. Aceptamos efectivo, tarjeta y transferencia.\nSeguros: no trabajamos con aseguradoras."}
              className={`${input} w-full`}
            />
            <span>
              El asistente responde con esto preguntas sobre dirección, parqueo, precios, formas de pago o seguros. Lo que
              no esté aquí lo pasa al equipo.
            </span>
          </Field>
          <Field label="Indicaciones para el asistente (opcional)">
            <textarea
              name="agentInstructions"
              rows={4}
              maxLength={4000}
              defaultValue={business.agentInstructions ?? ""}
              placeholder="Ej.: Estamos en Colonia Escalón, Paseo General Escalón 123. Pedir llegar 10 minutos antes."
              className={`${input} w-full`}
            />
          </Field>
          <div>
            <button className={primary}>Guardar</button>
          </div>
        </form>
      </section>

      <section id="plan" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Plan y pagos</h2>
        <div className="card flex flex-col gap-3 p-4 text-sm">
          <p className="font-medium">{standingLabel(billing, business.timezone)}</p>
          {business.monthlyPriceCents && <p>Plan mensual: {formatMoney(business.monthlyPriceCents)}.</p>}
          {pendingInvoices.map((inv) => (
            <div key={inv.id} className="notice notice-warn">
              <p className="font-medium">
                Factura {transferReference(inv)}: {formatMoney(inv.amountCents, inv.currency)}, del {inv.periodStart} al {inv.periodEnd}
              </p>
              <p className="mt-1">
                Transfiera el monto y escriba <span className="font-mono">{transferReference(inv)}</span> como referencia o
                concepto. Registramos el pago cuando llega la transferencia.
              </p>
              {bank && <pre className="mt-2 whitespace-pre-wrap font-sans">{bank}</pre>}
            </div>
          ))}
          {paidInvoices.length > 0 && (
            <ul className="divide-y">
              {paidInvoices.map((inv) => (
                <li key={inv.id} className="flex justify-between gap-2 py-1">
                  <span>
                    {transferReference(inv)} · del {inv.periodStart} al {inv.periodEnd}
                  </span>
                  <span className="text-neutral-500">{formatMoney(inv.amountCents, inv.currency)} · Pagada</span>
                </li>
              ))}
            </ul>
          )}
          {pendingInvoices.length === 0 && paidInvoices.length === 0 && (
            <p className="text-neutral-500">Aún no hay facturas. Praxia le enviará la primera antes de que termine su prueba.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-neutral-500">
      {label}
      {children}
    </label>
  );
}

function PractitionerInputs(p: { displayName: string; specialty: string | null; jvpmNumber: string | null }) {
  return (
    <>
      <Field label="Nombre">
        <input name="displayName" defaultValue={p.displayName} required placeholder="Dra. Ana López" className={`${input} w-56`} />
      </Field>
      <Field label="Especialidad (opcional)">
        <input name="specialty" defaultValue={p.specialty ?? ""} placeholder="Medicina general" className={`${input} w-44`} />
      </Field>
      <Field label="N.º JVPM (opcional)">
        <input name="jvpmNumber" defaultValue={p.jvpmNumber ?? ""} className={`${input} w-28`} />
      </Field>
    </>
  );
}

function IntakeInputs(f: { label: string; type: "text" | "date" | "choice"; options: string[]; required: boolean }) {
  return (
    <>
      <Field label="Pregunta">
        <input name="label" defaultValue={f.label} required placeholder="Fecha de nacimiento" className={`${input} w-56`} />
      </Field>
      <Field label="Tipo">
        <select name="type" defaultValue={f.type} className={input}>
          {(["text", "date", "choice"] as const).map((t) => (
            <option key={t} value={t}>
              {typeLabel[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Opciones (separadas por coma)">
        <input name="options" defaultValue={f.options.join(", ")} placeholder="Sí, No" className={`${input} w-44`} />
      </Field>
      <label className="flex items-center gap-1 pb-1.5 text-sm">
        <input type="checkbox" name="required" defaultChecked={f.required} /> Obligatorio
      </label>
    </>
  );
}
