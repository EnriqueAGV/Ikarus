export default function BusinessLoading() {
  return <section aria-busy="true" aria-label="Cargando sección" className="space-y-4">
    <p role="status" className="text-sm text-muted">Cargando datos…</p>
    <div aria-hidden="true" className="card h-24 motion-safe:animate-pulse bg-black/[0.03]" />
    <div aria-hidden="true" className="card h-56 motion-safe:animate-pulse bg-black/[0.03]" />
  </section>;
}
