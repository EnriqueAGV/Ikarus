"use client";

import { useTransition } from "react";

export default function BusinessError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [pending, start] = useTransition();
  return <section className="card p-6" role="alert">
    <h2 className="text-lg font-semibold">No pudimos cargar esta sección</h2>
    <p className="mt-2 text-sm text-muted">No se ha confirmado el estado de los datos. Vuelve a cargar antes de tomar una decisión.</p>
    <button type="button" className="btn-primary mt-4" disabled={pending} onClick={() => start(() => retry())}>{pending ? "Cargando…" : "Volver a cargar"}</button>
  </section>;
}
