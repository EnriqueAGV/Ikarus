import Link from "next/link";
export function Pagination({ page, pageSize, total, href }: { page: number; pageSize: number; total: number; href: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
    <p>{total ? `Mostrando ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} de ${total}` : "0 resultados"}</p>
    <div className="flex items-center gap-3">
      {page > 1 && <Link className="btn-secondary" href={href(page - 1)}>Anterior</Link>}
      <span>Página {page} de {pages}</span>
      {page < pages && <Link className="btn-secondary" href={href(page + 1)}>Siguiente</Link>}
    </div>
  </nav>;
}
