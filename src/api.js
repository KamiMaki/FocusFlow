// Thin client for the local JSON persistence endpoint (/api/data).

export async function loadData() {
  const res = await fetch('/api/data', { cache: 'no-store' });
  if (!res.ok) throw new Error('load failed: ' + res.status);
  const j = await res.json();
  // Self-heal a legacy double-encoded payload (a JSON string of the object).
  return typeof j === 'string' ? JSON.parse(j) : j;
}

async function put(data) {
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('save failed: ' + res.status);
  return res.json();
}

/**
 * Debounced autosaver. `schedule(data)` coalesces rapid changes into one PUT
 * ~`delay`ms after the last change; `flush()` sends the pending snapshot
 * immediately (call it on beforeunload / visibilitychange). Uses sendBeacon on
 * flush when available so an unload save actually reaches the server.
 */
export function createSaver(delay = 500) {
  let timer = null;
  let pending = null;
  let dead = false; // set on 409: this tab holds a stale data generation

  const send = () => {
    if (pending == null) return;
    const snapshot = pending;
    pending = null;
    put(snapshot).catch((e) => {
      if (String(e && e.message).includes('409')) {
        dead = true;
        console.warn('[focusflow] data was reset elsewhere — this tab is stale, autosave disabled. Reload the page.');
      } else {
        console.error('[focusflow] autosave error', e);
      }
    });
  };

  return {
    schedule(data) {
      if (dead) return;
      pending = data;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; send(); }, delay);
    },
    flush() {
      if (dead) return;
      if (timer) { clearTimeout(timer); timer = null; }
      if (pending == null) return;
      const snapshot = pending;
      pending = null;
      try {
        if (navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
          navigator.sendBeacon('/api/data', blob);
          return;
        }
      } catch { /* fall through to fetch */ }
      put(snapshot).catch(() => {});
    },
  };
}
