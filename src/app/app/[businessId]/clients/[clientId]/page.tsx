import { displayDate } from "@/lib/dates";
import { DateInput } from "@/components/date-input";
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
import { MergeCandidate } from "@/components/dashboard/merge-candidate";
import { intakeReviewFields, RECEIVED_IDENTITY_LABELS } from "@/lib/dashboard/intake-review";
import { WorkflowButton } from "@/components/dashboard/workflow-button";
import { Conversation } from "@/components/dashboard/conversation";
import { RecordForm } from "@/components/dashboard/record-form";
import { SubmitButton } from "@/components/submit-button";
import { replyEligibility } from "@/lib/messaging/eligibility";
import { LIVE_APPOINTMENT_STATUSES } from "@/db/schema";
import { editPatientAction, editClinicalAction, replyAction, olderMessagesAction, resolveConversationAction, reviewedArchiveAction, reviewIntakeAction, verifyWhatsappAction } from "../../workflow-actions";
import { ConfirmButton } from "@/components/confirm-button";
import {
  restorePatientAction,
  setAgentPausedAction,
} from "../../actions";
import { startNoteAction } from "../../notes-actions";
import { removeAttachmentAction, uploadAttachmentAction } from "../../records-actions";

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
  const view = typeof sp.view === "string" && ["summary", "conversation", "appointments", "data", "clinical", "manage"].includes(sp.view) ? sp.view : "summary";
  const context = typeof sp.back === "string" ? new URLSearchParams(sp.back) : new URLSearchParams();
  const backQuery = new URLSearchParams();
  for (const key of ["q", "archived", "sort", "page"]) if (context.has(key)) backQuery.set(key, context.get(key)!);
  const base = `/app/${business.id}/clients/${clientId}`;
  const viewHref = (next: string) => `${base}?${new URLSearchParams({ view: next, ...(backQuery.size ? { back: backQuery.toString() } : {}), ...(sp.from === "inbox" ? { from: "inbox" } : {}) })}`;
  const [detail, fields, practitioners] = await Promise.all([
    getClientDetail(business.id, clientId),
    listIntakeFields(business.id),
    listPractitioners(business.id),
  ]);
  if (!detail) notFound();
  await logChartView(membership, clientId);
  const writes = can(membership, "notes.write") && membership.practitionerId !== null && !detail.client.mergedIntoId && !detail.client.archivedAt;
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
  const tz = business.timezone;
  const recordError = typeof sp.recordError === "string" ? settingsErrorLabel[sp.recordError] ?? "Algo salió mal." : null;
  const archivedNow = typeof sp.archived === "string" ? Number(sp.archived) : null;
  const saved =
    archivedNow !== null
      ? `Paciente archivado.${archivedNow > 0 ? ` Se cancelaron ${archivedNow === 1 ? "1 cita próxima" : `${archivedNow} citas próximas`}.` : ""}`
      : typeof sp.saved === "string"
        ? savedLabel[sp.saved]
        : null;
  const input = "rounded-2xl border border-black/15 px-3.5 py-3 text-sm min-h-11";
  const label = "field-label";
  const editable = !client.archivedAt && !client.mergedIntoId;
  const intakeReviews = intakeReviewFields(client.data, fields, client);
  const now = new Date();
  const upcoming = appointments.filter(({ appointment: a }) => (LIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status) && a.endsAt >= now).sort((a, b) => a.appointment.startsAt.getTime() - b.appointment.startsAt.getTime());
  const history = appointments.filter(a => !upcoming.includes(a));
  const lastInboundAt = detail.lastInboundAt;

  // Answers to questions the business later removed are still shown, by key.
  const known = new Set(fields.map((f) => f.key));
  const answers = [
    ...fields.map((f) => ({ label: f.label, value: client.data[f.key] })),
    ...Object.entries(client.data)
      .filter(([k]) => !known.has(k))
      .map(([k, v]) => ({ label: RECEIVED_IDENTITY_LABELS[k] ?? k, value: v })),
  ];

  return (
    <div className="dashboard-view">
      <Link href={sp.from === "inbox" ? `/app/${business.id}/inbox` : `/app/${business.id}/clients?${backQuery}`} className="text-sm text-muted hover:underline">
        ← {sp.from === "inbox" ? "Por responder" : "Pacientes"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="dashboard-heading">{client.name ?? "Sin nombre"}</h2>
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">{client.mergedIntoId ? "Expediente unido" : client.archivedAt ? "Archivado" : "Paciente activo"}</span>
          {editable && <Link href={`/app/${business.id}/appointments/new?clientId=${client.id}`} className="btn-primary">Agendar cita</Link>}
        </div>
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
            Paciente archivado el {formatLocal(client.archivedAt, tz, "dd-MM-yyyy")}. No aparece en Pacientes ni lo ve el
            asistente. Restaurarlo no recupera las citas canceladas.
          </span>
          <form action={restorePatientAction.bind(null, business.id, client.id)}>
            <button className="btn-secondary">Restaurar</button>
          </form>
        </div>
      )}
      {recordError && <p role="alert" className="notice notice-error text-sm">{recordError}</p>}
      {saved && <p role="status" className="notice notice-ok text-sm">{saved}</p>}

      <nav aria-label="Secciones del paciente" className="section-tabs">
        {[["summary", "Resumen"], ["conversation", "Conversación"], ["appointments", "Citas"], ["data", "Datos"], ...(clinical ? [["clinical", "Expediente clínico"]] : []), ["manage", "Administrar expediente"]].map(([key, name]) => <Link key={key} href={viewHref(key)} aria-current={view === key ? "page" : undefined}>{name}</Link>)}
      </nav>

      {view === "summary" && <section className="card dashboard-card">
        <h3 className="mb-5 font-semibold">Resumen del paciente</h3>
        <dl className="grid gap-5 sm:grid-cols-3">
          <div><dt className="text-sm text-muted">Fecha de nacimiento</dt><dd className="mt-1 font-medium">{client.dateOfBirth ? displayDate(client.dateOfBirth) : "Sin registrar"}</dd></div>
          <div><dt className="text-sm text-muted">WhatsApp</dt><dd className="mt-1 font-medium">{formatPhone(conversation.waPhone)}</dd>{conversation.waPhone && !conversation.waVerifiedAt && <dd className="mt-1 text-xs text-amber-900">Sin verificar: el asistente no muestra datos del expediente hasta que quien escribe confirme una fecha de nacimiento o DUI.{editable && <form action={verifyWhatsappAction.bind(null, business.id, client.id)} className="mt-1"><SubmitButton pendingText="Guardando…" className="btn-secondary">Marcar como verificado</SubmitButton></form>}</dd>}{others.length > 0 && <dd className="mt-1 text-xs text-muted">Contacto compartido · recibe {conversation.name ?? "el titular del número"}</dd>}</div>
          <div><dt className="text-sm text-muted">Atención del equipo</dt><dd className="mt-1 font-medium">{conversation.attentionStatus === "needs_reply" ? "Pendiente de respuesta" : conversation.attentionStatus === "follow_up" ? "En seguimiento" : "Sin pendientes"}</dd><dd className="mt-1 text-xs text-muted">{conversation.agentPaused ? "Asistente en pausa" : "Asistente activo"}</dd></div>
        </dl>
        {clinical && <div className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2"><div><p className="text-sm text-muted">Alergias registradas</p><p className="mt-1 whitespace-pre-wrap text-sm">{client.allergies || "Sin información registrada"}</p></div><div><p className="text-sm text-muted">Enfermedades crónicas registradas</p><p className="mt-1 whitespace-pre-wrap text-sm">{client.chronicConditions || "Sin información registrada"}</p></div></div>}
      </section>}

      {view === "data" && <section id="datos" className="card dashboard-card">
        <h3 className="mb-6 font-semibold">Datos del paciente</h3>
        <dl className="grid gap-5 sm:grid-cols-2">
          {[["WhatsApp", formatPhone(client.waPhone)], ["Nombre", client.name], ["Fecha de nacimiento", client.dateOfBirth ? displayDate(client.dateOfBirth) : null], ["Sexo", client.sex === "female" ? "Femenino" : client.sex === "male" ? "Masculino" : null], ["DUI", client.dui], ["Dirección", client.address], ["Responsable", client.guardianName], ["Teléfono del responsable", client.guardianPhone], ["Contacto de emergencia", client.emergencyContactName], ["Teléfono de emergencia", client.emergencyContactPhone], ["Médico de preferencia", practitioners.find(p => p.id === client.preferredPractitionerId)?.displayName]].map(([key, value]) => <div key={key}><dt className="text-sm text-muted">{key}</dt><dd className="mt-1 break-words text-sm">{value || "Sin registrar"}</dd></div>)}
        </dl>
        {editable && <div className="mt-6 flex justify-end">
        <RecordForm action={editPatientAction.bind(null, business.id, client.id)} modalTitle="Editar datos del paciente" submitLabel="Guardar datos" className="grid gap-5 sm:grid-cols-2" reviewPhone={client.waPhone ?? ""} reviewTitle="Revisar cambio de WhatsApp" review={<>
          <p>Contacto actual: {formatPhone(client.waPhone)}</p>
          <p>Expediente: {client.name ?? "Sin nombre"}.</p>
          {!client.holderId && others.length > 0 && <p className="notice notice-warn">También cambia el WhatsApp de: {others.map(o => o.name ?? "Sin nombre").join(", ")}.</p>}
          <p>Si el nuevo número pertenece a otro paciente, se comparte su conversación. Los datos y el contacto se guardarán juntos.</p>
        </>}>
          <label className={`${label} sm:col-span-2`}>WhatsApp
            <input name="phone" type="tel" defaultValue={client.waPhone ?? ""} placeholder="7000 0000" className={input} />
            <span className="text-xs">Déjalo vacío si el paciente no usa WhatsApp. Si el número pertenece a otro paciente, pasa a compartirlo.{!client.holderId && others.length > 0 && " Cambiarlo también actualiza el contacto de quienes lo comparten."}</span>
          </label>
          <label className={label}>
            Nombre completo
            <input name="name" defaultValue={client.name ?? ""} required className={input} />
          </label>
          <label className={label}>
            Fecha de nacimiento
            <DateInput name="dateOfBirth" defaultValue={client.dateOfBirth ?? ""} className={input} />
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
            <input name="guardianPhone" type="tel" defaultValue={client.guardianPhone ?? ""} className={input} />
          </label>
          <label className={label}>
            Contacto de emergencia
            <input name="emergencyContactName" defaultValue={client.emergencyContactName ?? ""} className={input} />
          </label>
          <label className={label}>
            Teléfono de emergencia
            <input name="emergencyContactPhone" type="tel" defaultValue={client.emergencyContactPhone ?? ""} className={input} />
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
        </RecordForm>
        </div>}
      </section>}

      {clinical && view === "clinical" && (
        <section id="clinico" className="card dashboard-card">
          <h3 className="mb-1 font-semibold">Datos clínicos</h3>
          <p className="mb-3 text-xs text-neutral-500">Solo los doctores del consultorio ven esta sección.</p>
          <fieldset disabled={!editable}><RecordForm action={editClinicalAction.bind(null, business.id, client.id)} className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              Alergias
              <textarea name="allergies" rows={3} defaultValue={client.allergies ?? ""} className={input} />
            </label>
            <label className={label}>
              Enfermedades crónicas
              <textarea name="chronicConditions" rows={3} defaultValue={client.chronicConditions ?? ""} className={input} />
            </label>
          </RecordForm></fieldset>
        </section>
      )}

      {clinical && view === "clinical" && (
        <section id="notas" className="card dashboard-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">Notas clínicas</h3>
            {writes &&
              (visits.length > 0 ? (
                <form action={startNoteAction.bind(null, business.id, client.id, null)} className="flex items-center gap-2">
                  <select name="appointmentId" defaultValue={visits[0].id} className={input} aria-label="Cita">
                    {visits.map((v) => (
                      <option key={v.id} value={v.id}>
                        {formatLocal(v.startsAt, tz, "dd-MM-yyyy, h:mm a")} · {v.serviceName}
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
                        Cita del {formatLocal(group[0].appointmentStartsAt, tz, "dd-MM-yyyy, h:mm a")} · {group[0].serviceName}
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
                            <span className="capitalize">{formatLocal(n.signedAt ?? n.createdAt, tz, "dd-MM-yyyy")}</span> · {n.practitionerName}
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

      {clinical && view === "clinical" && (
        <section id="recetas" className="card dashboard-card">
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
                    <span className="shrink-0 capitalize text-neutral-500">{formatLocal(rx.createdAt, tz, "dd-MM-yyyy")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {clinical && view === "clinical" && (
        <section id="archivos" className="card dashboard-card">
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
                      · {formatBytes(f.sizeBytes)} · {formatLocal(f.createdAt, tz, "dd-MM-yyyy")}
                      {f.appointmentStartsAt && ` · cita del ${formatLocal(f.appointmentStartsAt, tz, "dd-MM-yyyy")}`}
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
          {editable && (
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
                      {formatLocal(v.startsAt, tz, "dd-MM-yyyy")} · {v.serviceName}
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

      {(view === "summary" || view === "data" || view === "appointments") && <div className="grid gap-6">
        {(view === "summary" || view === "data") && <section className="card dashboard-card">
          <h3 className="mb-3 font-semibold">Datos recibidos por WhatsApp</h3>
          <p className="mb-4 text-xs text-muted">Respuestas originales del contacto. Confirma las diferencias antes de actualizar el expediente.</p>
          {answers.length === 0 ? (
            <p className="text-sm text-neutral-500">El consultorio no pide datos adicionales.</p>
          ) : (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {answers.map((a) => (
                <div key={a.label} className="min-w-0">
                  <dt className="text-neutral-500">{a.label}</dt>
                  <dd className="mt-1 break-words">{a.value === undefined || a.value === null || a.value === "" ? "—" : displayDate(String(a.value))}</dd>
                </div>
              ))}
            </dl>
          )}
          {intakeReviews.map(item => <div key={item.key} className="mt-5 border-t pt-4">
            <p className="text-sm font-medium">{item.label}: {item.same ? "Coincide con el expediente" : item.reviewed ? "Diferencia revisada" : "Requiere revisión"}</p>
            {!item.same && <p className="mt-1 text-sm text-muted">Recibido: {displayDate(item.received)} · Expediente: {item.canonical ? displayDate(item.canonical) : "Sin registrar"}</p>}
            {item.reviewedAt && <p className="mt-1 text-xs text-muted">Revisado {formatLocal(new Date(item.reviewedAt), tz, "dd-MM-yyyy, h:mm a")}</p>}
            {editable && !item.same && !item.reviewed && <RecordForm action={reviewIntakeAction.bind(null, business.id, client.id, item.key, item.received)} className="mt-3 space-y-3" dirtyWarning={false} submitTone="secondary" submitLabel="Confirmar dato revisado">
              <label className="field-label">Dato que quedará en el expediente<select name="decision" defaultValue="" required><option value="" disabled>Seleccionar</option><option value="received">Usar respuesta recibida por WhatsApp</option><option value="record">Conservar dato actual del expediente</option></select></label>
            </RecordForm>}
          </div>)}
        </section>}

        {(view === "summary" || view === "appointments") && <section className="card dashboard-card">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Citas</h3>
            {editable && <Link href={`/app/${businessId}/appointments/new?clientId=${client.id}`} className="btn-secondary">Agendar cita</Link>}
          </div>
          {(view === "summary" ? upcoming.length : appointments.length) === 0 ? (
            <p className="text-sm text-muted">{view === "summary" ? "Sin próximas citas." : "Sin citas todavía."}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {[...upcoming, ...(view === "appointments" ? history : [])].map(({ appointment: a, serviceName, practitionerName }) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span>
                    <span className="mb-1 block text-xs text-muted">{upcoming.some(row => row.appointment.id === a.id) ? "Próxima cita" : "Historial"} · {practitionerName}</span>
                    <Link href={`/app/${business.id}?date=${formatLocal(a.startsAt, tz, "yyyy-MM-dd")}`} className="hover:underline"><span className="capitalize">{formatLocal(a.startsAt, tz, "dd-MM-yyyy, h:mm a")}</span> · {serviceName}</Link>
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${appointmentTone(a)}`}>
                    {appointmentLabel(a)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>}
      </div>}

      {view === "conversation" && <Conversation key={conversation.id} messages={messages} hasOlder={detail.hasOlderMessages} timezone={tz}
        recipient={conversation.name ?? "Contacto sin nombre"} phone={formatPhone(conversation.waPhone)}
        eligibility={replyEligibility(!!business.phoneNumberId, conversation.waPhone, lastInboundAt)}
        paused={conversation.agentPaused} readOnly={!editable}
        reply={replyAction.bind(null, business.id, client.id)} loadOlder={olderMessagesAction.bind(null, business.id, client.id)}
        controls={editable && <>
          {(conversation.attentionStatus === "needs_reply" || conversation.attentionStatus === "follow_up") && <WorkflowButton action={resolveConversationAction.bind(null, business.id, client.id, messages.at(-1)?.id ?? null)}>Marcar resuelta</WorkflowButton>}
          {conversation.waPhone && <form action={setAgentPausedAction.bind(null, business.id, client.id, !conversation.agentPaused)}><SubmitButton pendingText="Actualizando…" className="btn-secondary">{conversation.agentPaused ? "Devolver al asistente" : "Atender conversación"}</SubmitButton></form>}

        </>}
      />}

      {clinical && view === "clinical" && (
        <section className="card dashboard-card">
          <h3 className="mb-3 font-semibold">Accesos al expediente</h3>
          <ul className="flex flex-col gap-1 text-sm">
            {access.map((a) => (
              <li key={a.id} className="flex justify-between gap-2">
                <span>
                  {a.practitionerName ?? a.fullName ?? a.email} · {accessActionLabel[a.action]}
                </span>
                <span className="text-neutral-500">{formatLocal(a.createdAt, tz, "dd-MM-yyyy, h:mm a")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === "manage" && !mergedInto && (
        <section id="duplicados" className="card dashboard-card">
          <h3 className="mb-1 font-semibold">Posibles duplicados</h3>
          <p className="mb-3 text-sm text-neutral-500">
            Si esta persona también está registrada en otro expediente, únelo aquí: sus citas, su conversación y los datos que
            falten pasan a este paciente, y el otro queda archivado. Sus notas firmadas no cambian y se ven en este expediente.
          </p>
          <form className="mb-3 flex gap-2">
            <input type="hidden" name="view" value="manage" /><input name="dup" aria-label="Buscar posibles duplicados" defaultValue={dupQuery} placeholder="Buscar otro paciente por nombre o teléfono" className={`${input} w-full max-w-sm`} />
            <button className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">Buscar</button>
          </form>
          {duplicates.length === 0 ? (
            <p className="text-sm text-neutral-500">{dupQuery ? "Nadie coincide con la búsqueda." : "No encontramos otro expediente parecido."}</p>
          ) : (
            <ul className="divide-y text-sm">
              {duplicates.map(d => <MergeCandidate key={d.id} businessId={business.id} keep={client} dropId={d.id} />)}
            </ul>
          )}
        </section>
      )}

      {view === "manage" && !client.archivedAt && (
        <section className="card dashboard-card">
          <h3 className="mb-1 font-semibold">Archivar paciente</h3>
          <p className="mb-3 text-sm text-neutral-500">
            Deja de aparecer en Pacientes y el asistente ya no lo ve. Sus citas próximas se cancelan. El expediente no se
            borra, porque debe conservarse, y puedes restaurarlo cuando quieras.
          </p>
          <RecordForm action={reviewedArchiveAction.bind(null, business.id, client.id)} dirtyWarning={false} submitTone="danger" submitLabel="Archivar paciente" reviewTitle="Archivar paciente y cancelar citas" review={<>
            <p className="font-semibold">Paciente: {client.name ?? "Sin nombre"}</p>
            <p>Se conserva el expediente y sus documentos. Deja de aparecer entre los pacientes activos.</p>
            <p className="font-semibold">{upcoming.filter(row => row.appointment.startsAt > now).length} citas próximas se cancelarán:</p>
            <ul className="space-y-2">{upcoming.filter(row => row.appointment.startsAt > now).map(({ appointment: a, serviceName, practitionerName }) => <li key={a.id}>{formatLocal(a.startsAt, tz, "dd-MM-yyyy, h:mm a")} · {serviceName} · {practitionerName}</li>)}</ul>
            <p className="notice notice-warn">Restaurar al paciente no recupera las citas canceladas.</p>
          </>}>
            {upcoming.filter(row => row.appointment.startsAt > now).map(({ appointment: a }) => <input key={a.id} type="hidden" name="appointmentId" value={a.id} />)}
          </RecordForm>
        </section>
      )}
    </div>
  );
}
