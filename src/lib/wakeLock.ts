/**
 * Screen Wake Lock, held for the duration of an active recording.
 *
 * The one non-obvious platform fact that motivates this module: browsers
 * release a screen wake lock automatically whenever the tab is hidden, so
 * holding one for the length of a call means re-requesting it every time the
 * tab becomes visible again — a single request at recording start is not
 * enough on its own (D-14).
 */

let sentinel: WakeLockSentinel | null = null;

/**
 * Requests the screen wake lock. Never throws — returns `false` immediately
 * when `wakeLock` is absent from `navigator`, and `false` when the request is
 * rejected (low battery, power-save mode, and a non-visible document all
 * reject). A `false` return is a soft warning for the caller to surface, not
 * a reason to block or interrupt a recording.
 */
export async function acquireWakeLock(): Promise<boolean> {
  if (!("wakeLock" in navigator)) return false;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    return true;
  } catch {
    return false;
  }
}

/** Releases the held sentinel, if any, and clears it. Safe to call repeatedly. */
export function releaseWakeLock(): void {
  sentinel?.release().catch(() => {
    // Already released or releasing — nothing further to clean up.
  });
  sentinel = null;
}

/**
 * Adds a `visibilitychange` listener that re-requests the lock whenever the
 * document becomes visible again while `isRecordingActive` still holds and no
 * sentinel is currently held — the only way to hold the lock across a
 * tab-switch, since the browser silently drops it on hide. Returns the
 * removal function for effect cleanup.
 *
 * The caller is told the outcome of every re-acquire attempt via `onResult` —
 * this is what lets a soft warning track reality across a tab switch, rather
 * than only ever reflecting the initial acquire at recording start (WR-01).
 */
export function installWakeLockReacquire(
  isRecordingActive: () => boolean,
  onResult: (gotLock: boolean) => void,
): () => void {
  const handler = () => {
    if (document.visibilityState === "visible" && isRecordingActive() && sentinel === null) {
      void acquireWakeLock().then(onResult);
    }
  };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
