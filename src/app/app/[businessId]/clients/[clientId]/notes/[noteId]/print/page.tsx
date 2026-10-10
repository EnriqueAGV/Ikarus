import Link from "next/link";
import { notFound } from "next/navigation";
import { NoteBody } from "@/components/dashboard/note-body";
import { PrintButton } from "@/components/print-button";
import { can, requireBusinessAccess } from "@/lib/auth";
import { describeCode } from "@/lib/cie10";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { getNote, logNotePrint, NoteError } from "@/lib/dashboard/notes";

// A signed note as the patient's copy: the doctor's header, the note number
// and the signature. Printing to PDF from the browser makes the file.
export default async function PrintNotePage({ params }: PageProps<"/app/[businessId]/clients/[clientId]/notes/[noteId]/print">) {
  const { businessId, clientId, noteId } = await params;
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "chart.clinical")) notFound();
  const detail = await getNote(membership, noteId).catch((err) => {
    if (err instanceof NoteError) return null;
    throw err;
  });
  if (!detail || detail.note.clientId !== clientId || detail.note.status !== "signed") notFound();
  await logNotePrint(membership, clientId);
  const { note, practitioner, client, addenda, signer } = detail;
  const { business } = membership;
  const tz = business.timezone;
  const codes = note.diagnosisCodes.map((code) => ({ code, description: describeCode(code) ?? "" }));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 bg-white p-6 text-black print:p-0">
      <div className="flex justify-between print:hidden">
        <Link href={`/app/${business.id}/clients/${client.id}/notes/${note.id}`} className="text-sm text-neutral-500 hover:underline">
          ← Volver a la nota
        </Link>
        <PrintButton />
      </div>
      <header className="flex justify-between gap-4 border-b pb-3">
        <div>
          <p className="text-lg font-semibold">{practitioner.displayName}</p>
          {practitioner.specialty && <p className="text-sm">{practitioner.specialty}</p>}
          {practitioner.jvpmNumber && <p className="text-sm">JVPM {practitioner.jvpmNumber}</p>}
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{business.name}</p>
          {business.displayPhone && <p>{business.displayPhone}</p>}
        </div>
      </header>
      <section className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <p>
          <span className="text-neutral-600">Paciente:</span> {client.name ?? formatPhone(client.waPhone)}
        </p>
        <p className="text-right">
          <span className="text-neutral-600">Nota n.º</span> {note.number}
        </p>
        <p>
          <span className="text-neutral-600">Fecha de nacimiento:</span> {client.dateOfBirth ?? "—"}
        </p>
        <p className="text-right">
          <span className="text-neutral-600">Fecha:</span> {formatLocal(note.createdAt, tz, "d MMM yyyy, HH:mm")}
        </p>
        {client.dui && (
          <p>
            <span className="text-neutral-600">DUI:</span> {client.dui}
          </p>
        )}
      </section>
      <NoteBody note={note} codes={codes} />
      {addenda.length > 0 && (
        <section className="flex flex-col gap-2 border-t pt-3">
          <h3 className="text-sm font-semibold">Adendas</h3>
          {addenda.map((a) => (
            <div key={a.id} className="text-sm">
              <p className="whitespace-pre-wrap">{a.body}</p>
              <p className="text-xs text-neutral-600">
                {a.practitionerName ?? a.authorName ?? a.authorEmail} · {formatLocal(a.createdAt, tz, "d MMM yyyy, HH:mm")}
              </p>
            </div>
          ))}
        </section>
      )}
      <footer className="mt-6 border-t pt-3 text-xs text-neutral-600">
        <p>
          Firmada electrónicamente por {signer?.fullName ?? practitioner.displayName} el {formatLocal(note.signedAt!, tz, "d MMM yyyy, HH:mm")}.
        </p>
        <p className="font-mono break-all">Huella SHA-256: {note.contentHash}</p>
      </footer>
    </div>
  );
}
