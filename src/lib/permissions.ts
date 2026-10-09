// Pure permission rules, kept apart from the session code in auth.ts so tests
// and data modules can use them.
export type Role = "doctor" | "assistant" | "super_admin";

// Doctors read clinical records, so their sessions need two factors (aal2).
export function needsSecondFactor(role: Role, level: string | null) {
  return role === "doctor" && level !== "aal2";
}

// Every permission check goes through here; pages and actions never test
// roles themselves. See the permission table in praxia-medical-plan.md.
export type Action =
  | "agenda" // see and manage appointments
  | "patients" // contact info and demographics, the DUI, WhatsApp conversations
  | "chart.clinical" // allergies, chronic conditions, notes and addenda
  | "notes.write" // write notes and addenda; signing is for the note's own doctor
  | "clinic.manage"; // settings, doctors' hours and services, the team

export function can(m: { role: Role; managesClinic: boolean }, action: Action) {
  switch (action) {
    case "agenda":
    case "patients":
      return true;
    // Only the clinic's doctors, never an assistant or Praxia's own staff (Art. 20).
    case "chart.clinical":
    case "notes.write":
      return m.role === "doctor";
    case "clinic.manage":
      return m.role === "super_admin" || m.managesClinic;
  }
}
