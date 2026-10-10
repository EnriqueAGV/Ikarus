"use client";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-full bg-brand px-4 py-1.5 text-sm text-white hover:bg-brand-hover print:hidden font-medium shadow-sm">
      Imprimir o guardar como PDF
    </button>
  );
}
