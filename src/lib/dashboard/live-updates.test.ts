import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeToDashboardChanges } from "./live-updates";

function setup(setAuth = vi.fn().mockResolvedValue(undefined)) {
  let broadcast: () => void = () => {};
  let status: (value: string) => void = () => {};
  const channel = {
    on: vi.fn((_type, _filter, callback) => { broadcast = callback; return channel; }),
    subscribe: vi.fn(callback => { status = callback; return channel; }),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    realtime: { setAuth },
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  const page = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const browser = new EventTarget();
  const refresh = vi.fn();
  const stop = subscribeToDashboardChanges({
    supabase: supabase as unknown as SupabaseClient,
    businessId: "clinic-a", refresh, page, browser,
  });
  return { supabase, channel, page, browser, refresh, stop, broadcast: () => broadcast(), status: (value: string) => status(value) };
}

describe("live dashboard updates", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it("authenticates a private clinic channel and groups writes without postponing indefinitely", async () => {
    const live = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(live.supabase.channel).toHaveBeenCalledWith("dashboard:clinic-a", { config: { private: true } });
    expect(live.supabase.realtime.setAuth).toHaveBeenCalledOnce();
    live.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(300);
    live.refresh.mockClear();
    live.broadcast();
    await vi.advanceTimersByTimeAsync(200);
    live.broadcast();
    await vi.advanceTimersByTimeAsync(100);
    expect(live.refresh).toHaveBeenCalledOnce();
    live.stop();
  });

  it("defers hidden-tab writes and catches up when visible", async () => {
    const live = setup();
    await vi.advanceTimersByTimeAsync(0);
    live.page.visibilityState = "hidden";
    live.status("SUBSCRIBED");
    live.broadcast();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(live.refresh).not.toHaveBeenCalled();
    live.page.visibilityState = "visible";
    live.page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(300);
    expect(live.refresh).toHaveBeenCalledOnce();
    live.stop();
  });

  it("catches missed writes on reconnect, focus and network recovery", async () => {
    const live = setup();
    await vi.advanceTimersByTimeAsync(0);
    live.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(300);
    live.refresh.mockClear();
    live.status("CHANNEL_ERROR");
    live.status("SUBSCRIBED");
    live.browser.dispatchEvent(new Event("online"));
    live.browser.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(300);
    expect(live.refresh).toHaveBeenCalledOnce();
    live.stop();
  });

  it("reconciles every minute while connected and every 30 seconds on failure", async () => {
    const live = setup();
    await vi.advanceTimersByTimeAsync(0);
    live.status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(300);
    live.refresh.mockClear();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.refresh).toHaveBeenCalledOnce();
    live.status("TIMED_OUT");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(live.refresh).toHaveBeenCalledTimes(2);
    live.stop();
  });

  it("keeps automatic reconciliation when live authentication fails", async () => {
    const live = setup(vi.fn().mockRejectedValue(new Error("offline")));
    await vi.advanceTimersByTimeAsync(30_300);
    expect(live.channel.subscribe).not.toHaveBeenCalled();
    expect(live.refresh).toHaveBeenCalledOnce();
    live.stop();
  });

  it("cleans up pending refreshes, subscriptions and listeners", async () => {
    const live = setup();
    await vi.advanceTimersByTimeAsync(0);
    live.broadcast();
    live.stop();
    live.broadcast();
    live.status("SUBSCRIBED");
    live.browser.dispatchEvent(new Event("focus"));
    live.page.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(live.refresh).not.toHaveBeenCalled();
    expect(live.supabase.removeChannel).toHaveBeenCalledWith(live.channel);
  });

  it("does not subscribe when unmounted before authentication finishes", async () => {
    let resolve!: () => void;
    const live = setup(vi.fn(() => new Promise<void>(done => { resolve = done; })));
    live.stop();
    resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(live.channel.subscribe).not.toHaveBeenCalled();
    expect(live.supabase.removeChannel).toHaveBeenCalledOnce();
  });
});
