"use client";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { FormAction, FormResult } from "@/lib/dashboard/form-result";

// Submit manually so React never resets uncontrolled fields after validation failure.
export function RecordForm({ action, children, className, submitLabel = "Guardar cambios", submitTone = "primary", dirtyWarning = true, review, reviewTitle = "Revisar cambios", resetOnSuccess = false }: {
  action: FormAction; children: React.ReactNode; className?: string; submitLabel?: string;
  dirtyWarning?: boolean; review?: React.ReactNode; reviewTitle?: string; resetOnSuccess?: boolean;
  submitTone?: "primary" | "secondary" | "danger";
}) {
  const [result, setResult] = useState<FormResult | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [reviewValues, setReviewValues] = useState<string[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const payload = useRef<FormData | null>(null);
  const router = useRouter();
  const titleId = useId();
  const errorId = useId();
  const submitClass = { primary: "btn-primary", secondary: "btn-secondary", danger: "btn-danger" }[submitTone];
  useEffect(() => {
    if (pending || !result || result.ok || !result.field) return;
    const field = form.current?.elements.namedItem(result.field);
    if (field instanceof HTMLElement) {
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", errorId);
      field.focus();
    }
  }, [pending, result, errorId]);
  useEffect(() => {
    if (!dirty || !dirtyWarning) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest("a[href]");
      if (link && !event.defaultPrevented && !window.confirm("Hay cambios sin guardar. ¿Salir sin guardarlos?")) event.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", navigate, true); };
  }, [dirty, dirtyWarning]);
  const send = (data: FormData) => start(async () => {
    setResult(null);
    try {
      const next = await action(data);
      setResult(next);
      if (next.ok) { setDirty(false); if (resetOnSuccess) form.current?.reset(); dialog.current?.close(); if (next.href) router.push(next.href); }
    } catch { setResult({ ok: false, message: "No se pudo completar el cambio. Tus datos siguen aquí; vuelve a intentarlo." }); }
  });
  return <>
    <form ref={form} className={className} onChange={event => { setDirty(true); if (event.target instanceof HTMLElement) { event.target.removeAttribute("aria-invalid"); event.target.removeAttribute("aria-describedby"); } }} onSubmit={event => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      if (review) { payload.current = data; setReviewValues(["phone"].flatMap(key => data.has(key) ? [`Nuevo WhatsApp: ${String(data.get(key)) || "Sin WhatsApp"}`] : [])); dialog.current?.showModal(); }
      else send(data);
    }} aria-busy={pending}>
      <fieldset disabled={pending} className="contents">{children}</fieldset>
      {result && <p id={errorId} role={result.ok ? "status" : "alert"} className={`notice ${result.ok ? "notice-ok" : "notice-error"} col-span-full`}>{result.message}</p>}
      <div className="col-span-full flex flex-wrap items-center justify-between gap-3 pt-4">
        <span className="text-xs text-muted">{dirty && dirtyWarning ? "Cambios sin guardar" : ""}</span>
        <div className="flex flex-wrap gap-2">{dirtyWarning && <button type="button" disabled={pending} className="btn-quiet" onClick={() => { form.current?.reset(); form.current?.querySelectorAll('[aria-invalid="true"]').forEach(field => { field.removeAttribute("aria-invalid"); field.removeAttribute("aria-describedby"); }); setDirty(false); setResult(null); }}>Cancelar cambios</button>}<button type="submit" disabled={pending} className={submitClass}>{pending ? "Guardando…" : submitLabel}</button></div>
      </div>
    </form>
    {review && <dialog ref={dialog} aria-labelledby={titleId} className="review-dialog" onClose={() => form.current?.querySelector<HTMLButtonElement>('[type="submit"]')?.focus()} onCancel={event => { if (pending) event.preventDefault(); }}>
      <h3 id={titleId} className="text-xl font-semibold">{reviewTitle}</h3>
      <div className="my-5 space-y-4 text-sm">{review}{reviewValues.map(value => <p key={value} className="font-medium">{value}</p>)}</div>
      {result && !result.ok && <p role="alert" className="notice notice-error mb-4">{result.message}</p>}
      <div className="flex flex-wrap justify-end gap-2"><button type="button" disabled={pending} className="btn-quiet" onClick={() => dialog.current?.close()}>Volver</button><button type="button" disabled={pending} className={submitClass} onClick={() => { if (payload.current) send(payload.current); }}>{pending ? "Aplicando…" : "Confirmar cambios"}</button></div>
    </dialog>}
  </>;
}
