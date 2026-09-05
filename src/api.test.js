import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSaver } from "./api.js";
const ok = () => ({ ok: true, status: 200 });
const microtasks = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("reliable local saves", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it("coalesces edits and serializes a later snapshot after a slow first request", async () => {
    let resolveFirst;
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFirst = r;
          }),
      )
      .mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetch);
    const saver = createSaver(500);
    saver.schedule({ text: "a" });
    saver.schedule({ text: "b" });
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule({ text: "c" });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFirst(ok());
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ text: "c" });
    expect(saver.hasPending()).toBe(false);
  });
  it("retains the latest content after a failed save and retries it explicitly", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetch);
    const status = vi.fn();
    const saver = createSaver(500, status);
    saver.schedule({ text: "draft" });
    await vi.advanceTimersByTimeAsync(500);
    expect(status).toHaveBeenLastCalledWith("error");
    saver.schedule({ text: "latest draft" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    saver.retry();
    await microtasks();
    expect(JSON.parse(fetch.mock.calls[1][1].body).text).toBe("latest draft");
    expect(status).toHaveBeenLastCalledWith("saved");
  });
  it("stops all writes from a stale generation", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    vi.stubGlobal("fetch", fetch);
    const status = vi.fn();
    const saver = createSaver(500, status);
    saver.schedule({ rev: "old" });
    saver.flush();
    await microtasks();
    saver.schedule({ rev: "old", text: "new" });
    saver.retry();
    saver.flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("stale");
    expect(saver.hasPending()).toBe(true);
  });
  it("flushes a pending snapshot immediately and supports navigation for small payloads", async () => {
    const fetch = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetch);
    const saver = createSaver(500);
    saver.schedule({ text: "note" });
    saver.flush();
    await microtasks();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].keepalive).toBe(true);
  });
  it("does not indefinitely postpone saving while the user keeps typing", async () => {
    const fetch = vi.fn().mockResolvedValue(ok());
    vi.stubGlobal("fetch", fetch);
    const saver = createSaver(500);
    for (let i = 0; i < 8; i++) {
      saver.schedule({ text: String(i) });
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(fetch).toHaveBeenCalled();
  });
});
