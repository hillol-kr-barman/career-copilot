export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "cc_theme";

/**
 * Dark is the default. A stored choice always wins — someone who has picked
 * light keeps light — but a first-time visitor lands on the dark ground, and
 * so does anyone whose storage is unreadable (private browsing).
 */
export const loadTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
};

/**
 * Applied to <html> so the CSS custom properties resolve before anything
 * paints, and `color-scheme` brings native controls and scrollbars along.
 *
 * Called from main.tsx before render rather than from an inline <script> in
 * index.html: the production CSP sets scriptSrc to 'self' with no
 * 'unsafe-inline', so an inline theme bootstrap would be blocked.
 */
export const applyTheme = (theme: Theme): void => {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  // Keep the browser chrome on the same ground as the page. These are the
  // --ground values from index.css; a mismatch shows as a light bar above a
  // dark page on mobile Safari and Chrome, so they have to be changed together.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0b0e14" : "#fcfcfd");
};

export const storeTheme = (theme: Theme): void => {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* Private browsing — the choice just won't survive the session. */
  }
};

/** Cleared alongside the rest of this browser's data by "Clear stored data". */
export const forgetTheme = (): void => {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* no-op */
  }
};
