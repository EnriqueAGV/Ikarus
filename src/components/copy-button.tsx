"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-full border px-4 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 bg-white"
    >
      {copied ? "Copiado" : "Copiar enlace"}
    </button>
  );
}
