"use client";
import { useState, useTransition } from "react";
import type { FormResult } from "@/lib/dashboard/form-result";
export function WorkflowButton({ action, children }: { action: () => Promise<FormResult>; children: React.ReactNode }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return <div><button type="button" className="btn-secondary" disabled={pending} onClick={() => start(async () => {
    try { const result = await action(); setError(result.ok ? null : result.message); }
    catch { setError("No se pudo actualizar. Vuelve a intentarlo."); }
  })}>{pending ? "Actualizando…" : children}</button>{error && <p role="alert" className="mt-2 max-w-sm text-xs text-red-800">{error}</p>}</div>;
}
