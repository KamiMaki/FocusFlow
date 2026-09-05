// Client for the local JSON endpoint. Writes are serialized so slower saves
// cannot replace a newer snapshot. Failed content stays queued for retry.
export async function loadData() {
  const res = await fetch("/api/data", { cache: "no-store" });
  if (!res.ok) throw new Error("load failed: " + res.status);
  const json = await res.json();
  return typeof json === "string" ? JSON.parse(json) : json;
}

export function createSaver(delay = 500, onStatus = () => {}) {
  let timer = null;
  let pending = null;
  let inflight = null;
  let stale = false;
  let failed = false;
  let flushRequested = false;
  let firstPendingAt = null;
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const send = async () => {
    if (stale || inflight || pending == null) return;
    clearTimer();
    const snapshot = pending;
    pending = null;
    firstPendingAt = null;
    failed = false;
    onStatus("saving");
    // keepalive supports small writes on navigation. Larger snapshots are
    // ordinary fetches: beforeunload warns while an unconfirmed write remains.
    const body = JSON.stringify(snapshot);
    const request = fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: new Blob([body]).size < 60000,
    });
    inflight = request;
    try {
      const res = await request;
      if (res.status === 409) {
        stale = true;
        onStatus("stale");
        return;
      }
      if (!res.ok) throw new Error("save failed: " + res.status);
      onStatus(pending == null ? "saved" : "saving");
    } catch {
      pending = pending ?? snapshot;
      failed = true;
      onStatus("error");
    } finally {
      inflight = null;
      if (!stale && !failed && pending != null) {
        if (flushRequested || timer == null) send();
      }
      flushRequested = false;
    }
  };
  return {
    schedule(data) {
      if (stale) return;
      pending = data;
      firstPendingAt ??= Date.now();
      // Preserve a visible failure until an explicit retry or reconnect.
      if (failed) return;
      onStatus("saving");
      clearTimer();
      timer = setTimeout(
        () => {
          timer = null;
          send();
        },
        Math.max(0, Math.min(delay, 2000 - (Date.now() - firstPendingAt))),
      );
    },
    flush() {
      if (stale || failed) return;
      clearTimer();
      flushRequested = true;
      send();
    },
    retry() {
      if (stale) return;
      failed = false;
      clearTimer();
      send();
    },
    hasPending() {
      return stale || pending != null || inflight != null;
    },
  };
}
