import { createHash } from "node:crypto";
import type { schema } from "@/db";
type Patient = typeof schema.clients.$inferSelect;
export const mergeFields = ["name", "dateOfBirth", "sex", "dui", "address", "guardianName", "guardianPhone", "emergencyContactName", "emergencyContactPhone", "preferredPractitionerId"] as const;
export function mergeReviewToken(keep: Patient, drop: Patient) {
  return createHash("sha256").update(JSON.stringify([keep, drop].map(p => ({ id: p.id, values: mergeFields.map(key => p[key]), data: p.data, phone: p.waPhone, holder: p.holderId, merged: p.mergedIntoId, archived: p.archivedAt })))).digest("hex");
}
