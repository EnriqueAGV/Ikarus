export type IntakeReview = Record<string, { received: string; canonical: string | null; reviewedAt: string }>;
export function intakeReviewFields(data: Record<string, unknown>, fields: { key: string; label: string }[], patient: { dateOfBirth: string | null; dui: string | null; intakeReview: IntakeReview }) {
  return Object.entries(data).flatMap(([key, raw]) => {
    if (typeof raw !== "string" || !raw.trim()) return [];
    const label = fields.find(f => f.key === key)?.label ?? key;
    const target = /dui/i.test(`${key} ${label}`) ? "dui" as const : /fecha[_ ](?:de[_ ])?nacimiento/i.test(`${key} ${label}`) ? "dateOfBirth" as const : null;
    if (!target) return [];
    const canonical = patient[target];
    const same = target === "dui" ? raw.replace(/\D/g, "") === canonical?.replace(/\D/g, "") : raw === canonical;
    const review = patient.intakeReview[key];
    const reviewed = review?.received === raw && review.canonical === canonical;
    return [{ key, label, received: raw, canonical, target, same, reviewed, reviewedAt: reviewed ? review.reviewedAt : null }];
  });
}
