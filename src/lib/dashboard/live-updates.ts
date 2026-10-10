import type { SupabaseClient } from "@supabase/supabase-js";

// Broadcasts carry no records. The refreshed server components still enforce
// membership, trusted-device and clinical permissions before returning data.
export function subscribeToDashboardChanges({
  supabase, businessId, refresh, page = document, browser = window,
}: {
  supabase: SupabaseClient;
  businessId: string;
  refresh: () => void;
  page?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  browser?: Pick<Window, "addEventListener" | "removeEventListener">;
}) {
  let stopped = false;
  let connected = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const scheduleRefresh = () => {
    if (stopped) return;
    dirty = true;
    if (page.visibilityState !== "visible" || timer !== undefined) return;
    // Coalesce a reschedule's cancellation + booking and intake update bursts.
    timer = setTimeout(() => {
      timer = undefined;
      if (stopped || page.visibilityState !== "visible") return;
      dirty = false;
      refresh();
    }, 300);
  };
  const resume = () => scheduleRefresh();
  const channel = supabase
    .channel(`dashboard:${businessId}`, { config: { private: true } })
    .on("broadcast", { event: "changed" }, scheduleRefresh);

  // Reconcile missed events periodically, including deployments before the
  // migration is applied. Background tabs do not request server renders.
  let ticks = 0;
  const reconcile = setInterval(() => {
    ticks += 1;
    if (!connected || ticks % 2 === 0 || dirty) scheduleRefresh();
  }, 30_000);
  page.addEventListener("visibilitychange", resume);
  browser.addEventListener("focus", resume);
  browser.addEventListener("online", resume);

  void supabase.realtime.setAuth().then(() => {
    if (stopped) return;
    channel.subscribe(status => {
      if (stopped) return;
      connected = status === "SUBSCRIBED";
      // Also catches writes between the server render and joining/rejoining.
      if (connected) scheduleRefresh();
    });
  }).catch(() => {
    // Automatic reconciliation remains available if authentication/network fails.
    connected = false;
  });

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    clearInterval(reconcile);
    page.removeEventListener("visibilitychange", resume);
    browser.removeEventListener("focus", resume);
    browser.removeEventListener("online", resume);
    void supabase.removeChannel(channel);
  };
}
