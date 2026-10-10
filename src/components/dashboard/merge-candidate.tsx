import { displayDate } from "@/lib/dates";
import { getClientDetail } from "@/lib/dashboard/appointments";
import { mergeFields, mergeReviewToken } from "@/lib/dashboard/record-review";
import { formatPhone } from "@/lib/dashboard/labels";
import type { schema } from "@/db";
import { RecordForm } from "./record-form";
import { reviewedMergeAction } from "@/app/app/[businessId]/workflow-actions";

const labels: Record<string, string> = { name: "Nombre", dateOfBirth: "Nacimiento", sex: "Sexo", dui: "DUI", address: "Dirección", guardianName: "Responsable", guardianPhone: "Teléfono del responsable", emergencyContactName: "Contacto de emergencia", emergencyContactPhone: "Teléfono de emergencia", preferredPractitionerId: "Médico de preferencia" };
export async function MergeCandidate({ businessId, keep, dropId }: { businessId: string; keep: typeof schema.clients.$inferSelect; dropId: string }) {
  const detail = await getClientDetail(businessId, dropId);
  if (!detail) return null;
  const drop = detail.client;
  const conflicts = mergeFields.filter(key => keep[key] && drop[key] && keep[key] !== drop[key]);
  const format = (key: typeof mergeFields[number], value: string | null) => !value ? "Sin registrar" : key === "dateOfBirth" ? displayDate(value) : key === "dui" ? `••••••${value.slice(-3)}` : key === "preferredPractitionerId" ? "Médico asignado" : value;
  return <li className="py-5">
    <p className="font-medium">{drop.name ?? "Sin nombre"} · {formatPhone(drop.waPhone)}</p>
    <p className="my-2 text-xs text-muted">Coincidencia por nombre o búsqueda manual. Compartir WhatsApp no demuestra que sean la misma persona.</p>
    <RecordForm action={reviewedMergeAction.bind(null, businessId, keep.id, drop.id, mergeReviewToken(keep, drop))} dirtyWarning={false} submitTone="secondary" submitLabel="Revisar y unir expedientes" reviewTitle="Revisar unión de expedientes" review={<>
      <div className="grid gap-4 sm:grid-cols-2"><div className="rounded-lg border p-4"><p className="mb-3 font-semibold">Conservar: {keep.name ?? "Sin nombre"}</p><p>{keep.dateOfBirth ? displayDate(keep.dateOfBirth) : "Nacimiento sin registrar"}</p><p>{formatPhone(keep.waPhone)}</p><p>DUI: {format("dui", keep.dui)}</p></div><div className="rounded-lg border p-4"><p className="mb-3 font-semibold">Unir y archivar: {drop.name ?? "Sin nombre"}</p><p>{drop.dateOfBirth ? displayDate(drop.dateOfBirth) : "Nacimiento sin registrar"}</p><p>{formatPhone(drop.waPhone)}</p><p>DUI: {format("dui", drop.dui)}</p><p>{detail.appointments.length} citas registradas</p></div></div>
      {keep.waPhone && drop.waPhone === keep.waPhone && <p className="notice notice-warn">Comparten WhatsApp. Pueden ser familiares con expedientes distintos; verifica la identidad antes de unir.</p>}
      {conflicts.length > 0 && <div><h4 className="mb-2 font-semibold">Datos diferentes · se conservarán los del expediente principal</h4><ul className="space-y-2">{conflicts.map(key => <li key={key}><span className="font-medium">{labels[key]}: </span>{format(key, keep[key])} <span className="text-muted">/ expediente a unir: {format(key, drop[key])}</span></li>)}</ul></div>}
      <p>Las citas y los datos faltantes pasan al expediente principal. Los documentos firmados conservan su origen. Los datos clínicos se combinan; solo los doctores pueden revisarlos.</p>
      {detail.others.length > 0 && <p className="notice notice-warn">El contacto está relacionado con: {detail.others.map(p => p.name ?? "Sin nombre").join(", ")}. La unión puede cambiar la titularidad del WhatsApp.</p>}
      {keep.waPhone && drop.waPhone && keep.waPhone !== drop.waPhone && <p>Se conserva {formatPhone(keep.waPhone)}; el otro número deja de estar asociado al expediente unido.</p>}
      <p className="font-semibold text-red-800">Esta unión no se puede deshacer.</p>
    </>}>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="samePerson" required className="mt-1 h-5 w-5" /><span>Verifiqué que estos expedientes pertenecen a la misma persona y que los datos del expediente principal deben conservarse si son distintos.</span></label>
    </RecordForm>
  </li>;
}
