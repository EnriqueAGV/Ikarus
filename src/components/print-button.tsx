"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-hover print:hidden">
      Imprimir o guardar como PDF
    </button>
  );
}
