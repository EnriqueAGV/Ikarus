export type IntakeReview = Record<string, { received: string; canonical: string | null; reviewedAt: string }>;

// A name or DUI the assistant received for a record whose name and DUI staff
// already confirmed. It is kept under these keys for review instead of
// overwriting the record.
export const RECEIVED_NAME_KEY = "nombre_whatsapp";
export const RECEIVED_DUI_KEY = "dui_whatsapp";
export const RECEIVED_IDENTITY_LABELS: Record<string, string> = {
  [RECEIVED_NAME_KEY]: "Nombre recibido por WhatsApp",
  [RECEIVED_DUI_KEY]: "DUI recibido por WhatsApp",
};

const sameName = (a: string, b: string | null) => a.trim().replace(/\s+/g, " ").toLowerCase() === (b ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function intakeReviewFields(data: Record<string, unknown>, fields: { key: string; label: string }[], patient: { name: string | null; dateOfBirth: string | null; dui: string | null; intakeReview: IntakeReview }) {
  return Object.entries(data).flatMap(([key, raw]) => {
    if (typeof raw !== "string" || !raw.trim()) return [];
    const label = RECEIVED_IDENTITY_LABELS[key] ?? fields.find(f => f.key === key)?.label ?? key;
    const target = key === RECEIVED_NAME_KEY ? "name" as const : /dui/i.test(`${key} ${label}`) ? "dui" as const : /fecha[_ ](?:de[_ ])?nacimiento/i.test(`${key} ${label}`) ? "dateOfBirth" as const : null;
    if (!target) return [];
    const canonical = patient[target];
    const same = target === "dui" ? raw.replace(/\D/g, "") === canonical?.replace(/\D/g, "") : target === "name" ? sameName(raw, canonical) : raw === canonical;
    const review = patient.intakeReview[key];
    const reviewed = review?.received === raw && review.canonical === canonical;
    return [{ key, label, received: raw, canonical, target, same, reviewed, reviewedAt: reviewed ? review.reviewedAt : null }];
  });
}
