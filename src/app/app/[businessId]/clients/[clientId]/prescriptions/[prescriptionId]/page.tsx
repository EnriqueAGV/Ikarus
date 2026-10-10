import { displayDate } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { can, requireBusinessAccess } from "@/lib/auth";
import { formatLocal, formatPhone } from "@/lib/dashboard/labels";
import { getPrescription, logPrescriptionPrint } from "@/lib/dashboard/prescriptions";

// A receta as the patient takes it: the doctor's header, the drugs and the
// date. Opening it is logged; printing to PDF from the browser makes the file.
export default async function PrescriptionPage({ params, searchParams }: PageProps<"/app/[businessId]/clients/[clientId]/prescriptions/[prescriptionId]">) {
  const { businessId, clientId, prescriptionId } = await params;
  const sp = await searchParams;
  const membership = await requireBusinessAccess(businessId);
  if (!can(membership, "chart.clinical")) notFound();
  const row = await getPrescription(membership, prescriptionId);
  if (!row || row.prescription.clientId !== clientId) notFound();
  await logPrescriptionPrint(membership, clientId);
  const { prescription, practitioner, client } = row;
  const { business } = membership;
  const tz = business.timezone;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/app/${business.id}/clients/${client.id}#recetas`} className="text-sm text-neutral-500 hover:underline">
          ← {client.name ?? "Paciente"}
        </Link>
        <PrintButton />
      </div>
      {sp.issued && <p className="notice notice-ok text-sm print:hidden">Receta emitida.</p>}
      <article className="card flex flex-col gap-5 bg-white p-8 text-black print:border-0 print:p-0">
        <header className="flex justify-between gap-4 border-b pb-3">
          <div>
            <p className="text-lg font-semibold">{practitioner.displayName}</p>
            {practitioner.specialty && <p className="text-sm">{practitioner.specialty}</p>}
            {practitioner.jvpmNumber && <p className="text-sm">JVPM {practitioner.jvpmNumber}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">{business.name}</p>
            {business.locationAddress && <p>{business.locationAddress}</p>}
            {business.displayPhone && <p>{business.displayPhone}</p>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <p>
            <span className="text-neutral-600">Paciente:</span> {client.name ?? formatPhone(client.waPhone)}
          </p>
          <p className="text-right">
            <span className="text-neutral-600">Fecha:</span> {formatLocal(prescription.createdAt, tz, "dd-MM-yyyy")}
          </p>
          {client.dateOfBirth && (
            <p>
              <span className="text-neutral-600">Fecha de nacimiento:</span> {displayDate(client.dateOfBirth)}
            </p>
          )}
        </section>
        <section>
          <p className="mb-2 font-serif text-2xl italic">Rx</p>
          <ol className="flex flex-col gap-3">
            {prescription.items.map((item, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium">
                  {i + 1}. {item.drug}
                </p>
                {(item.dose || item.frequency || item.duration) && (
                  <p className="pl-4 text-neutral-700">{[item.dose, item.frequency, item.duration && `por ${item.duration}`].filter(Boolean).join(", ")}</p>
                )}
              </li>
            ))}
          </ol>
        </section>
        {prescription.instructions && (
          <section className="text-sm">
            <p className="text-neutral-600">Indicaciones</p>
            <p className="whitespace-pre-wrap">{prescription.instructions}</p>
          </section>
        )}
        <footer className="mt-12 flex justify-end">
          <div className="w-56 border-t pt-1 text-center text-xs text-neutral-600">
            Firma y sello
            <br />
            {practitioner.displayName}
          </div>
        </footer>
      </article>
    </div>
  );
}
