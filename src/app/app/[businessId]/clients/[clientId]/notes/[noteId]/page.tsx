import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { NoteBody } from "@/components/dashboard/note-body";
import { NoteEditor } from "@/components/dashboard/note-editor";
import { SubmitButton } from "@/components/submit-button";
import { can, requireBusinessAccess } from "@/lib/auth";
import { describeCode } from "@/lib/cie10";
import { getNote, NoteError, verifySignature } from "@/lib/dashboard/notes";
import { formatLocal, settingsErrorLabel } from "@/lib/dashboard/labels";
import { addAddendumAction, deleteDraftAction, saveDraftAction, searchCodesAction, signNoteAction } from "../../../../notes-actions";

export default async function NotePage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]/notes/[noteId]">) {
  const { businessId, clientId, noteId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  const { business } = membership;
  if (!can(membership, "chart.clinical")) notFound();
  const detail = await getNote(membership, noteId).catch((err) => {
    if (err instanceof NoteError) return null;
    throw err;
  });
  if (!detail || detail.note.clientId !== clientId) notFound();
  const { note, practitioner, client, addenda, signer, appointment } = detail;
  const tz = business.timezone;
  const back = `/app/${business.id}/clients/${client.id}`;
  const error = typeof sp.error === "string" ? (settingsErrorLabel[sp.error] ?? "Algo salió mal.") : null;
  const mine = note.practitionerId === membership.practitionerId;
  const codes = note.diagnosisCodes.map((code) => ({ code, description: describeCode(code) ?? "" }));

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <Link href={`${back}#notas`} className="text-sm text-neutral-500 hover:underline">
        ← {client.name ?? "Paciente"}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">
            {note.status === "signed" ? `Nota ${note.number}` : "Nota en borrador"}
          </h2>
          <p className="text-sm text-neutral-500">
            {practitioner.displayName} · <span className="capitalize">{formatLocal(note.createdAt, tz, "EEEE d MMM yyyy, HH:mm")}</span>
            {appointment && ` · cita de ${appointment.serviceName}`}
          </p>
        </div>
        {note.status === "signed" && (
          <Link href={`${back}/notes/${note.id}/print`} className="rounded-md border px-3 py-1.5 text-sm">
            Imprimir o PDF
          </Link>
        )}
      </header>
      {error && <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>}
      {sp.signed && <p className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">Nota firmada.</p>}

      {note.status === "draft" && mine ? (
        <>
          <NoteEditor
            initial={{
              subjective: note.subjective ?? "",
              objective: note.objective ?? "",
              assessment: note.assessment ?? "",
              plan: note.plan ?? "",
              bloodPressure: note.vitals?.bloodPressure ?? "",
              heartRate: note.vitals?.heartRate?.toString() ?? "",
              temperature: note.vitals?.temperature?.toString() ?? "",
              weight: note.vitals?.weight?.toString() ?? "",
              height: note.vitals?.height?.toString() ?? "",
              spo2: note.vitals?.spo2?.toString() ?? "",
            }}
            initialCodes={codes}
            save={saveDraftAction.bind(null, business.id, note.id)}
            sign={signNoteAction.bind(null, business.id, client.id, note.id)}
            search={searchCodesAction.bind(null, business.id)}
            errors={settingsErrorLabel}
          />
          <form action={deleteDraftAction.bind(null, business.id, client.id, note.id)} className="flex justify-end">
            <ConfirmButton message="¿Descartar este borrador?" className="text-xs text-red-700 hover:underline dark:text-red-400">
              Descartar borrador
            </ConfirmButton>
          </form>
        </>
      ) : (
        <>
          {note.status === "draft" && (
            <p className="rounded-md border p-3 text-sm text-neutral-600 dark:text-neutral-300">
              Borrador de {practitioner.displayName}. Solo ese doctor puede editarlo y firmarlo.
            </p>
          )}
          <NoteBody note={note} codes={codes} />
          {note.status === "signed" && (
            <p className="text-xs text-neutral-500">
              Firmada por {signer?.fullName ?? signer?.email} el {formatLocal(note.signedAt!, tz, "d MMM yyyy, HH:mm")}.{" "}
              {verifySignature(note) ? "El contenido coincide con la firma." : "El contenido NO coincide con la firma."}
            </p>
          )}
        </>
      )}

      {note.status === "signed" && (
        <section id="adendas" className="flex flex-col gap-3 rounded-md border p-4">
          <h3 className="font-medium">Adendas</h3>
          {addenda.length === 0 && <p className="text-sm text-neutral-500">Sin adendas.</p>}
          <ol className="flex flex-col gap-3">
            {addenda.map((a) => (
              <li key={a.id} className="text-sm">
                <p className="whitespace-pre-wrap">{a.body}</p>
                <p className="text-xs text-neutral-500">
                  {a.practitionerName ?? a.authorName ?? a.authorEmail} · {formatLocal(a.createdAt, tz, "d MMM yyyy, HH:mm")}
                </p>
              </li>
            ))}
          </ol>
          {can(membership, "notes.write") && (
            <form action={addAddendumAction.bind(null, business.id, client.id, note.id)} className="flex flex-col gap-2">
              <textarea name="body" rows={3} required placeholder="Corrección o información nueva, con fecha y tu nombre" className="rounded-md border px-2 py-1 text-sm" />
              <div className="flex justify-end">
                <SubmitButton pendingText="Agregando…" className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover disabled:opacity-60">
                  Agregar adenda
                </SubmitButton>
              </div>
            </form>
          )}
        </section>
      )}
    </div>
  );
}
