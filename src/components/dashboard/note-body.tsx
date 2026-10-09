import type { Vitals } from "@/db/schema";
import { vitalsLabel } from "@/lib/dashboard/labels";

// A note's SOAP sections, read-only: signed notes, other doctors' drafts and the print view.
export function NoteBody({
  note,
  codes,
}: {
  note: { subjective: string | null; objective: string | null; vitals: Vitals | null; assessment: string | null; plan: string | null };
  codes: { code: string; description: string }[];
}) {
  const vitals = Object.entries(note.vitals ?? {}).filter(([, v]) => v !== undefined && v !== null) as [keyof Vitals, string | number][];
  const section = (title: string, body: string | null, extra?: React.ReactNode) => (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      {body ? <p className="whitespace-pre-wrap text-sm">{body}</p> : !extra && <p className="text-sm text-neutral-400">—</p>}
      {extra}
    </section>
  );
  return (
    <div className="flex flex-col gap-4">
      {section("Subjetivo", note.subjective)}
      {section(
        "Objetivo",
        note.objective,
        vitals.length > 0 && (
          <p className="text-sm">
            {vitals.map(([k, v]) => `${vitalsLabel[k][0]} ${v} ${vitalsLabel[k][1]}`).join(" · ")}
          </p>
        ),
      )}
      {section(
        "Evaluación",
        note.assessment,
        codes.length > 0 && (
          <ul className="text-sm">
            {codes.map((c) => (
              <li key={c.code}>
                <span className="font-mono">{c.code}</span> {c.description}
              </li>
            ))}
          </ul>
        ),
      )}
      {section("Plan", note.plan)}
    </div>
  );
}
