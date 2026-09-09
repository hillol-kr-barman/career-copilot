/**
 * Small, pure time-formatting helpers shared across the Live Interview
 * components. Extracted because `formatElapsed` and `formatRelativeTime`
 * were copy-pasted byte-for-byte in more than one component (IN-02);
 * import from here instead of re-declaring a local copy.
 */

/** An elapsed duration as `mm:ss`, e.g. "03:07". Negative input clamps to zero. */
export const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
};

/** A human relative age, e.g. "12 minutes ago" — a human reads this faster than a timestamp. */
export const formatRelativeTime = (startedAt: number): string => {
  const diffMinutes = Math.round((Date.now() - startedAt) / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes === 1) return "1 minute ago";
  if (diffMinutes < 60) return `${diffMinutes} minutes ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours === 1) return "1 hour ago";
  if (diffHours < 24) return `${diffHours} hours ago`;
  const diffDays = Math.round(diffHours / 24);
  return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
};
