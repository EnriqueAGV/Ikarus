"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return <button type="button" className="btn-quiet" disabled={pending} onClick={() => start(() => router.refresh())}>{pending ? "Actualizando…" : "Actualizar"}</button>;
}
