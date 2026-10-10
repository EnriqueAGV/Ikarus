"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import type { SaveState } from "@/app/app/[businessId]/notes-actions";

type Code = { code: string; description: string };
type Fields = {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  bloodPressure: string;
  heartRate: string;
  temperature: string;
  weight: string;
  height: string;
  spo2: string;
};

const input = "rounded-xl border px-2 py-1.5 text-sm";
const label = "flex flex-col gap-1 text-xs text-neutral-500";
const AUTOSAVE_MS = 2000;

// The draft form. Changes save on their own a moment after the doctor stops
// typing; "Firmar" saves what is on screen and locks the note.
export function NoteEditor({
  initial,
  initialCodes,
  save,
  sign,
  search,
  errors,
}: {
  initial: Fields;
  initialCodes: Code[];
  save: (prev: SaveState, form: FormData) => Promise<SaveState>;
  sign: (form: FormData) => Promise<void>;
  search: (query: string) => Promise<Code[]>;
  errors: Record<string, string>;
}) {
  const form = useRef<HTMLFormElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, dispatch, saving] = useActionState(save, { savedAt: null, error: null });
  const [dirty, setDirty] = useState(false);
  const [codes, setCodes] = useState<Code[]>(initialCodes);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Code[]>([]);

  const saveNow = () => {
    if (timer.current) clearTimeout(timer.current);
    if (!form.current) return;
    const data = new FormData(form.current);
    setDirty(false);
    startTransition(() => dispatch(data));
  };
  const changed = () => {
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, AUTOSAVE_MS);
  };

  // Codes reach the form through hidden inputs, rendered before the autosave fires.
  const setCodesAndSave = (update: (codes: Code[]) => Code[]) => {
    setCodes(update);
    changed();
  };

  useEffect(() => {
    if (query.trim().length < 2) return;
    const t = setTimeout(() => search(query).then(setResults, () => setResults([])), 250);
    return () => clearTimeout(t);
  }, [query, search]);
  const shown = query.trim().length < 2 ? [] : results;

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const status = saving
    ? "Guardando…"
    : state.error
      ? (errors[state.error] ?? "No se pudo guardar.")
      : dirty
        ? "Cambios sin guardar"
        : state.savedAt
          ? `Guardado ${new Date(state.savedAt).toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" })}`
          : "Borrador";

  const area = (name: keyof Fields, title: string, hint: string) => (
    <label className={label}>
      <span>
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{title}</span> · {hint}
      </span>
      <textarea name={name} rows={4} defaultValue={initial[name]} className={input} />
    </label>
  );
  const vital = (name: keyof Fields, title: string, placeholder: string) => (
    <label className={label}>
      {title}
      <input name={name} defaultValue={initial[name]} placeholder={placeholder} inputMode="decimal" className={`${input} w-24`} />
    </label>
  );

  return (
    <form
      ref={form}
      onInput={(e) => {
        if ((e.target as HTMLElement).dataset.search === undefined) changed();
      }}
      onKeyDown={(e) => {
        // Enter in a one-line field saves; only the Firmar button signs.
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          if ((e.target as HTMLElement).dataset.search === undefined) saveNow();
        }
      }}
      className="flex flex-col gap-4"
    >
      {area("subjective", "S", "lo que refiere el paciente")}
      <fieldset className="flex flex-col gap-2">
        {area("objective", "O", "examen físico")}
        <div className="flex flex-wrap gap-3">
          {vital("bloodPressure", "Presión (mmHg)", "120/80")}
          {vital("heartRate", "Frec. cardiaca (lpm)", "72")}
          {vital("temperature", "Temperatura (°C)", "36.5")}
          {vital("weight", "Peso (kg)", "70")}
          {vital("height", "Talla (cm)", "165")}
          {vital("spo2", "SpO₂ (%)", "98")}
        </div>
      </fieldset>
      {area("assessment", "A", "evaluación e impresión diagnóstica")}

      <div className="flex flex-col gap-2">
        <span className="text-xs text-neutral-500">Diagnósticos (CIE-10)</span>
        <ul className="flex flex-col gap-1">
          {codes.map((c) => (
            <li key={c.code} className="flex items-center justify-between gap-2 rounded-xl border px-2 py-1.5 text-sm">
              <input type="hidden" name="diagnosisCodes" value={c.code} />
              <span>
                <span className="font-mono">{c.code}</span> {c.description}
              </span>
              <button
                type="button"
                onClick={() => setCodesAndSave((cs) => cs.filter((x) => x.code !== c.code))}
                className="text-xs text-red-700 hover:underline dark:text-red-400"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <input
          data-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por código o nombre: J06, faringitis…"
          className={input}
        />
        {shown.length > 0 && (
          <ul className="card max-h-60 overflow-y-auto text-sm">
            {shown.map((r) => (
              <li key={r.code}>
                <button
                  type="button"
                  onClick={() => {
                    setCodesAndSave((cs) => (cs.some((c) => c.code === r.code) ? cs : [...cs, r]));
                    setQuery("");
                  }}
                  className="w-full px-2 py-1 text-left hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  <span className="font-mono">{r.code}</span> {r.description}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {area("plan", "P", "plan, tratamiento e indicaciones")}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-xs ${state.error ? "text-red-600" : "text-neutral-500"}`}>{status}</span>
        <div className="flex gap-2">
          <button type="button" onClick={saveNow} className="rounded-full border px-4 py-1.5 text-sm bg-white hover:bg-neutral-50">
            Guardar
          </button>
          <button
            formAction={sign}
            onClick={(e) => {
              if (!window.confirm("¿Firmar la nota? Después no se puede cambiar; solo se le pueden agregar adendas.")) {
                e.preventDefault();
              } else if (timer.current) {
                clearTimeout(timer.current);
              }
            }}
            className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover font-medium shadow-sm"
          >
            Firmar
          </button>
        </div>
      </div>
    </form>
  );
}
