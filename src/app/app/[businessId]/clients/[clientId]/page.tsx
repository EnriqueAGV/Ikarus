import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requireBusinessAccess } from "@/lib/auth";
import { listPractitioners } from "@/lib/booking/practitioners";
import { getClientDetail } from "@/lib/dashboard/appointments";
import { ACCEPTED_TYPES, listAttachments } from "@/lib/dashboard/attachments";
import {
  accessActionLabel,
  appointmentLabel,
  appointmentTone,
  attachmentKindLabel,
  formatBytes,
  formatLocal,
  formatPhone,
  settingsErrorLabel,
} from "@/lib/dashboard/labels";
import { appointmentsForNotes, listNotes } from "@/lib/dashboard/notes";
import { duplicateCandidates, logChartView, recentAccess, recordIds } from "@/lib/dashboard/patients";
import { listPrescriptions } from "@/lib/dashboard/prescriptions";
import { listIntakeFields } from "@/lib/dashboard/settings";
import { ConfirmButton } from "@/components/confirm-button";
import {
  archivePatientAction,
  restorePatientAction,
  saveClinicalAction,
  saveDemographicsAction,
  setAgentPausedAction,
  staffReplyAction,
} from "../../actions";
import { startNoteAction } from "../../notes-actions";
import { changePhoneAction, mergePatientAction, removeAttachmentAction, uploadAttachmentAction } from "../../records-actions";

const savedLabel: Record<string, string> = {
  datos: "Datos guardados.",
  clinico: "Datos clínicos guardados.",
  nuevo: "Paciente registrado.",
  restaurado: "Paciente restaurado.",
  whatsapp: "Número de WhatsApp actualizado.",
  unido: "Expedientes unidos. Las citas, la conversación y los datos que faltaban pasaron a este paciente.",
  archivo: "Archivo agregado al expediente.",
  archivo_quitado: "Archivo quitado del expediente.",
};

export default async function ClientPage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]">) {
  const { businessId, clientId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  const { business } = membership;
  const clinical = can(membership, "chart.clinical");
  const [detail, fields, practitioners] = await Promise.all([
    getClientDetail(business.id, clientId),
    listIntakeFields(business.id),
    listPractitioners(business.id),
  ]);
  if (!detail) notFound();
  await logChartView(membership, clientId);
  const writes = can(membership, "notes.write") && membership.practitionerId !== null && !detail.client.mergedIntoId;
  // Signed notes, prescriptions and files of duplicates merged into this record show here too.
  const ids = await recordIds(business.id, clientId);
  const [access, notes, prescriptions, files] = clinical
    ? await Promise.all([
        recentAccess(business.id, clientId),
        listNotes(membership, ids),
        listPrescriptions(membership, ids),
        listAttachments(membership, ids),
      ])
    : [[], [], [], []];
  const visits = clinical ? await appointmentsForNotes(membership, clientId) : [];
  const dupQuery = typeof sp.dup === "string" ? sp.dup : "";
  const duplicates = detail.client.mergedIntoId ? [] : await duplicateCandidates(business.id, detail.client, dupQuery);
  const mergedInto = detail.client.mergedIntoId
    ? await getClientDetail(business.id, detail.client.mergedIntoId).then((d) => d?.client ?? null)
    : null;
  // Notes grouped by the appointment they belong to, newest visit first.
  const byVisit = new Map<string, typeof notes>();
  for (const n of notes) byVisit.set(n.appointmentId ?? "none", [...(byVisit.get(n.appointmentId ?? "none") ?? []), n]);
  const { client, conversation, others, appointments, messages } = detail;
  const shared = conversation.id !== client.id;
  const tz = business.timezone;
  const error = typeof sp.error === "string" ? settingsErrorLabel[sp.error] ?? "Algo salió mal." : null;
  const recordError = typeof sp.recordError === "string" ? settingsErrorLabel[sp.recordError] ?? "Algo salió mal." : null;
  const archivedNow = typeof sp.archived === "string" ? Number(sp.archived) : null;
  const saved =
    archivedNow !== null
      ? `Paciente archivado.${archivedNow > 0 ? ` Se cancelaron ${archivedNow === 1 ? "1 cita próxima" : `${archivedNow} citas próximas`}.` : ""}`
      : typeof sp.saved === "string"
        ? savedLabel[sp.saved]
        : null;
  const input = "rounded-xl border px-2 py-1.5 text-sm";
  const label = "flex flex-col gap-1 text-xs text-neutral-500";

  // Answers to questions the business later removed are still shown, by key.
  const known = new Set(fields.map((f) => f.key));
  const answers = [
    ...fields.map((f) => ({ label: f.label, value: client.data[f.key] })),
    ...Object.entries(client.data)
      .filter(([k]) => !known.has(k))
      .map(([k, v]) => ({ label: k, value: v })),
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link href={`/app/${business.id}/clients`} className="text-sm text-neutral-500 hover:underline">
        ← Pacientes
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{client.name ?? "Sin nombre"}</h2>
          <p className="text-sm text-neutral-500">{formatPhone(client.waPhone)}</p>
          {others.length > 0 && (
            <p className="mt-1 text-sm text-neutral-500">
              Comparte WhatsApp con{" "}
              {others.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ", "}
                  <Link href={`/app/${business.id}/clients/${o.id}`} className="underline">
                    {o.name ?? "Sin nombre"}
                  </Link>
                </span>
              ))}
            </p>
          )}
        </div>
        {conversation.waPhone && (
          <form action={setAgentPausedAction.bind(null, business.id, client.id, !conversation.agentPaused)}>
            {conversation.agentPaused ? (
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm text-amber-700 dark:text-amber-300">El asistente está en pausa con este número.</span>
                <button className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">
                  Reactivar asistente
                </button>
              </div>
            ) : (
              <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Pausar asistente</button>
            )}
          </form>
        )}
      </header>

      {mergedInto && (
        <div className="notice notice-info text-sm">
          Este expediente es un duplicado que se unió a{" "}
          <Link href={`/app/${business.id}/clients/${mergedInto.id}`} className="font-medium underline">
            {mergedInto.name ?? "otro paciente"}
          </Link>
          . Sus notas firmadas se ven allá.
        </div>
      )}
      {client.archivedAt && !mergedInto && (
        <div className="notice notice-warn flex flex-wrap items-center justify-between gap-3 text-sm">
          <span>
            Paciente archivado el {formatLocal(client.archivedAt, tz, "d 'de' MMMM yyyy")}. No aparece en Pacientes ni lo ve el
            asistente.
          </span>
          <form action={restorePatientAction.bind(null, business.id, client.id)}>
            <button className="rounded-xl border bg-white px-3 py-1.5 text-sm dark:bg-neutral-900">Restaurar</button>
          </form>
        </div>
      )}
      {recordError && <p className="notice notice-error text-sm">{recordError}</p>}
      {saved && <p className="notice notice-ok text-sm">{saved}</p>}

      <section id="datos" className="card p-5">
        <h3 className="mb-3 font-semibold">Datos del paciente</h3>
        {!mergedInto && (
          <form action={changePhoneAction.bind(null, business.id, client.id)} className="mb-4 flex flex-wrap items-end gap-3 border-b pb-4">
            <label className={label}>
              WhatsApp
              <input name="phone" type="tel" defaultValue={client.waPhone ?? ""} placeholder="7000 0000" className={input} />
            </label>
            <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Cambiar número</button>
            <p className="basis-full text-xs text-neutral-500">
              {others.length > 0 && !client.holderId
                ? "Quienes comparten este WhatsApp pasan también al nuevo número. "
                : ""}
              Déjalo vacío si el paciente no usa WhatsApp. Si el número ya es de otro paciente de la familia, este paciente pasa a compartirlo.
            </p>
          </form>
        )}
        <form action={saveDemographicsAction.bind(null, business.id, client.id)} className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            Nombre completo
            <input name="name" defaultValue={client.name ?? ""} className={input} />
          </label>
          <label className={label}>
            Fecha de nacimiento
            <input name="dateOfBirth" type="date" defaultValue={client.dateOfBirth ?? ""} className={input} />
          </label>
          <label className={label}>
            Sexo
            <select name="sex" defaultValue={client.sex ?? ""} className={input}>
              <option value="">Sin indicar</option>
              <option value="female">Femenino</option>
              <option value="male">Masculino</option>
            </select>
          </label>
          <label className={label}>
            DUI
            <input name="dui" defaultValue={client.dui ?? ""} placeholder="00000000-0" className={input} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Dirección
            <input name="address" defaultValue={client.address ?? ""} className={input} />
          </label>
          <label className={label}>
            Responsable (menores)
            <input name="guardianName" defaultValue={client.guardianName ?? ""} className={input} />
          </label>
          <label className={label}>
            Teléfono del responsable
            <input name="guardianPhone" defaultValue={client.guardianPhone ?? ""} className={input} />
          </label>
          <label className={label}>
            Contacto de emergencia
            <input name="emergencyContactName" defaultValue={client.emergencyContactName ?? ""} className={input} />
          </label>
          <label className={label}>
            Teléfono de emergencia
            <input name="emergencyContactPhone" defaultValue={client.emergencyContactPhone ?? ""} className={input} />
          </label>
          <label className={label}>
            Doctor de preferencia
            <select name="preferredPractitionerId" defaultValue={client.preferredPractitionerId ?? ""} className={input}>
              <option value="">Ninguno</option>
              {practitioners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                  {p.active ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-end justify-end">
            <button className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">Guardar datos</button>
          </div>
        </form>
      </section>

      {clinical && (
        <section id="clinico" className="card p-5">
          <h3 className="mb-1 font-semibold">Datos clínicos</h3>
          <p className="mb-3 text-xs text-neutral-500">Solo los doctores del consultorio ven esta sección.</p>
          <form action={saveClinicalAction.bind(null, business.id, client.id)} className="grid gap-3 sm:grid-cols-2">
            <label className={label}>
              Alergias
              <textarea name="allergies" rows={3} defaultValue={client.allergies ?? ""} className={input} />
            </label>
            <label className={label}>
              Enfermedades crónicas
              <textarea name="chronicConditions" rows={3} defaultValue={client.chronicConditions ?? ""} className={input} />
            </label>
            <div className="flex justify-end sm:col-span-2">
              <button className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">Guardar datos clínicos</button>
            </div>
          </form>
        </section>
      )}

      {clinical && (
        <section id="notas" className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Notas clínicas</h3>
            {writes &&
              (visits.length > 0 ? (
                <form action={startNoteAction.bind(null, business.id, client.id, null)} className="flex items-center gap-2">
                  <select name="appointmentId" defaultValue={visits[0].id} className={input} aria-label="Cita">
                    {visits.map((v) => (
                      <option key={v.id} value={v.id}>
                        {formatLocal(v.startsAt, tz, "EEE d MMM yyyy, HH:mm")} · {v.serviceName}
                      </option>
                    ))}
                  </select>
                  <button className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">Nueva nota</button>
                </form>
              ) : (
                <span className="text-sm text-neutral-500">
                  Cada nota va con una cita.{" "}
                  <Link href={`/app/${business.id}/appointments/new?clientId=${client.id}`} className="text-brand hover:underline">
                    Agenda una
                  </Link>{" "}
                  para escribirla.
                </span>
              ))}
          </div>
          {notes.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin notas todavía.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {[...byVisit.entries()].map(([visit, group]) => (
                <div key={visit}>
                  <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {group[0].appointmentStartsAt ? (
                      <span className="capitalize">
                        Cita del {formatLocal(group[0].appointmentStartsAt, tz, "EEE d MMM yyyy, HH:mm")} · {group[0].serviceName}
                      </span>
                    ) : (
                      "Sin cita"
                    )}
                  </h4>
                  <ul className="divide-y text-sm">
                    {group.map((n) => (
                      <li key={n.id}>
                        <Link href={`/app/${business.id}/clients/${n.clientId}/notes/${n.id}`} className="flex items-center justify-between gap-2 py-2 hover:underline">
                          <span>
                            {n.status === "signed" ? `Nota ${n.number}` : "Borrador"} ·{" "}
                            <span className="capitalize">{formatLocal(n.signedAt ?? n.createdAt, tz, "EEE d MMM yyyy")}</span> · {n.practitionerName}
                            {n.diagnosisCodes.length > 0 && <span className="font-mono text-neutral-500"> · {n.diagnosisCodes.join(", ")}</span>}
                            {n.addenda > 0 && <span className="text-neutral-500"> · {n.addenda === 1 ? "1 adenda" : `${n.addenda} adendas`}</span>}
                            {n.clientId !== client.id && <span className="text-neutral-500"> · del expediente unido</span>}
                          </span>
                          {n.status === "draft" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">Sin firmar</span>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {clinical && (
        <section id="recetas" className="card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Recetas</h3>
            {writes && (
              <Link
                href={`/app/${business.id}/clients/${client.id}/prescriptions/new`}
                className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm"
              >
                Nueva receta
              </Link>
            )}
          </div>
          {prescriptions.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin recetas todavía.</p>
          ) : (
            <ul className="divide-y text-sm">
              {prescriptions.map(({ prescription: rx, practitionerName }) => (
                <li key={rx.id}>
                  <Link href={`/app/${business.id}/clients/${rx.clientId}/prescriptions/${rx.id}`} className="flex justify-between gap-2 py-2 hover:underline">
                    <span>
                      {rx.items.map((i) => i.drug).join(", ")}
                      <span className="text-neutral-500"> · {practitionerName}</span>
                    </span>
                    <span className="shrink-0 capitalize text-neutral-500">{formatLocal(rx.createdAt, tz, "EEE d MMM yyyy")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {clinical && (
        <section id="archivos" className="card p-5">
          <h3 className="mb-3 font-semibold">Laboratorios y archivos</h3>
          {files.length === 0 ? (
            <p className="mb-3 text-sm text-neutral-500">Sin archivos todavía.</p>
          ) : (
            <ul className="mb-4 divide-y text-sm">
              {files.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <a href={`/app/${business.id}/clients/${f.clientId}/files/${f.id}`} target="_blank" rel="noreferrer" className="hover:underline">
                    <span className="mr-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600">{attachmentKindLabel[f.kind]}</span>
                    {f.fileName}
                    <span className="text-neutral-500">
                      {" "}
                      · {formatBytes(f.sizeBytes)} · {formatLocal(f.createdAt, tz, "d MMM yyyy")}
                      {f.appointmentStartsAt && ` · cita del ${formatLocal(f.appointmentStartsAt, tz, "d MMM")}`}
                    </span>
                  </a>
                  {f.clientId === client.id && (
                    <form action={removeAttachmentAction.bind(null, business.id, client.id, f.id)}>
                      <ConfirmButton message="¿Quitar este archivo del expediente?" className="text-xs text-neutral-500 hover:text-red-700">
                        Quitar
                      </ConfirmButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!mergedInto && (
            <form action={uploadAttachmentAction.bind(null, business.id, client.id)} className="flex flex-wrap items-end gap-3">
              <label className={label}>
                Archivo (PDF o imagen, hasta 4 MB)
                <input name="file" type="file" required accept={ACCEPTED_TYPES.join(",")} className="text-sm" />
              </label>
              <label className={label}>
                Tipo
                <select name="kind" defaultValue="lab" className={input}>
                  <option value="lab">Laboratorio</option>
                  <option value="image">Imagen</option>
                  <option value="other">Documento</option>
                </select>
              </label>
              <label className={label}>
                Cita
                <select name="appointmentId" defaultValue="" className={input}>
                  <option value="">Sin cita</option>
                  {visits.map((v) => (
                    <option key={v.id} value={v.id}>
                      {formatLocal(v.startsAt, tz, "d MMM yyyy")} · {v.serviceName}
                    </option>
                  ))}
                </select>
              </label>
              <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Subir</button>
              <p className="basis-full text-xs text-neutral-500">Se guarda cifrado. Solo los doctores del consultorio pueden abrirlo, y cada apertura queda registrada.</p>
            </form>
          )}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card p-5">
          <h3 className="mb-3 font-semibold">Respuestas por WhatsApp</h3>
          {answers.length === 0 ? (
            <p className="text-sm text-neutral-500">El consultorio no pide datos adicionales.</p>
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {answers.map((a) => (
                <div key={a.label} className="contents">
                  <dt className="text-neutral-500">{a.label}</dt>
                  <dd>{a.value === undefined || a.value === null || a.value === "" ? "—" : String(a.value)}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="card p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Citas</h3>
            <Link
              href={`/app/${businessId}/appointments/new?clientId=${client.id}`}
              className="rounded-full border px-3 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900 bg-white"
            >
              Agendar cita
            </Link>
          </div>
          {appointments.length === 0 ? (
            <p className="text-sm text-neutral-500">Sin citas todavía.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {appointments.map(({ appointment: a, serviceName }) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="capitalize">{formatLocal(a.startsAt, tz, "EEE d MMM yyyy, HH:mm")}</span> · {serviceName}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${appointmentTone(a)}`}>
                    {appointmentLabel(a)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section id="conversation" className="card p-5">
        <h3 className="mb-3 font-semibold">
          Conversación{shared && <span className="font-normal text-neutral-500"> · con {conversation.name ?? formatPhone(conversation.waPhone)}</span>}
        </h3>
        <ol className="flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
          {messages.map((m) => (
            <li
              key={m.id}
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                m.direction === "inbound"
                  ? "self-start bg-neutral-100 dark:bg-neutral-900"
                  : "self-end bg-emerald-100 dark:bg-emerald-950"
              }`}
            >
              <p className="whitespace-pre-wrap">{m.body ?? `(${m.type})`}</p>
              <p className="mt-1 text-[10px] text-neutral-500">
                {formatLocal(m.createdAt, tz, "d MMM, HH:mm")}
                {m.direction === "outbound" && (isStaff(m.payload) ? " · equipo" : " · asistente")}
              </p>
            </li>
          ))}
          {messages.length === 0 && <li className="text-sm text-neutral-500">Sin mensajes.</li>}
        </ol>
        {conversation.waPhone ? (
          <form action={staffReplyAction.bind(null, business.id, client.id)} className="mt-4 flex flex-col gap-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            {sp.sent && <p className="text-sm text-emerald-700">Mensaje enviado. El asistente quedó en pausa.</p>}
            <textarea name="text" rows={2} required placeholder="Responder como el consultorio" className="rounded-xl border px-3 py-2 text-sm" />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-neutral-500">Al responder, el asistente se pausa con este número.</p>
              <button className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm">
                Enviar por WhatsApp
              </button>
            </div>
          </form>
        ) : (
          <p className="mt-4 text-xs text-neutral-500">Este paciente no tiene WhatsApp registrado, así que no recibe mensajes ni recordatorios.</p>
        )}
      </section>

      {clinical && (
        <section className="card p-5">
          <h3 className="mb-3 font-semibold">Accesos al expediente</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {access.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>
                  {a.practitionerName ?? a.fullName ?? a.email} · {accessActionLabel[a.action]}
                </span>
                <span className="text-neutral-500">{formatLocal(a.createdAt, tz, "d MMM yyyy, HH:mm")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!mergedInto && (
        <section id="duplicados" className="card p-5">
          <h3 className="mb-1 font-semibold">Posibles duplicados</h3>
          <p className="mb-3 text-sm text-neutral-500">
            Si esta persona también está registrada en otro expediente, únelo aquí: sus citas, su conversación y los datos que
            falten pasan a este paciente, y el otro queda archivado. Sus notas firmadas no cambian y se ven en este expediente.
          </p>
          <form className="mb-3 flex gap-2">
            <input name="dup" defaultValue={dupQuery} placeholder="Buscar otro paciente por nombre o teléfono" className={`${input} w-full max-w-sm`} />
            <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Buscar</button>
          </form>
          {duplicates.length === 0 ? (
            <p className="text-sm text-neutral-500">{dupQuery ? "Nadie coincide con la búsqueda." : "No encontramos otro expediente parecido."}</p>
          ) : (
            <ul className="divide-y text-sm">
              {duplicates.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/app/${business.id}/clients/${d.id}`} className="hover:underline">
                    {d.name ?? "Sin nombre"}
                    <span className="text-neutral-500">
                      {" "}
                      · {formatPhone(d.waPhone)}
                      {d.dateOfBirth && ` · nació ${d.dateOfBirth}`} · registrado {formatLocal(d.createdAt, tz, "d MMM yyyy")}
                    </span>
                  </Link>
                  <form action={mergePatientAction.bind(null, business.id, client.id, d.id)}>
                    <ConfirmButton
                      message={`¿Unir a ${d.name ?? "ese paciente"} en este expediente? No se puede deshacer.`}
                      className="rounded-full border px-3 py-1 text-xs hover:bg-neutral-100 bg-white"
                    >
                      Unir aquí
                    </ConfirmButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!client.archivedAt && (
        <section className="card p-5">
          <h3 className="mb-1 font-semibold">Archivar paciente</h3>
          <p className="mb-3 text-sm text-neutral-500">
            Deja de aparecer en Pacientes y el asistente ya no lo ve. Sus citas próximas se cancelan. El expediente no se
            borra, porque debe conservarse, y puedes restaurarlo cuando quieras.
          </p>
          <form action={archivePatientAction.bind(null, business.id, client.id)}>
            <ConfirmButton
              message="¿Archivar a este paciente? Sus citas próximas se cancelarán."
              className="rounded-full border px-4 py-1.5 text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950 bg-white"
            >
              Archivar paciente
            </ConfirmButton>
          </form>
        </section>
      )}
    </div>
  );
}

function isStaff(payload: unknown) {
  return typeof payload === "object" && payload !== null && "sentBy" in payload;
}
