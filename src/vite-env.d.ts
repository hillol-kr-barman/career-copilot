/// <reference types="vite/client" />

/**
 * View Transitions API. Still missing from the DOM lib shipped with this
 * TypeScript version, so the two members used by the theme toggle are declared
 * here; `startViewTransition` is optional because it genuinely is absent in
 * some browsers and the caller feature-detects it.
 */
interface ViewTransition {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  skipTransition(): void;
}

interface Document {
  startViewTransition?: (callback: () => void) => ViewTransition;
}
