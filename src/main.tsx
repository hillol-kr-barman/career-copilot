import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { applyTheme, loadTheme } from "./lib/theme.ts";
import "./index.css";

// Before first paint, so a reader who chose dark doesn't get a flash of paper.
applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
