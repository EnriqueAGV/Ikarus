"use client";

import { startTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { subscribeToDashboardChanges } from "@/lib/dashboard/live-updates";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export function DashboardLiveUpdates({ businessId }: { businessId: string }) {
  const router = useRouter();

  useEffect(() => subscribeToDashboardChanges({
    supabase: createSupabaseBrowserClient(),
    businessId,
    refresh: () => startTransition(() => router.refresh()),
  }), [businessId, router]);

  return null;
}
