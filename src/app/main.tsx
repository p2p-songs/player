/** Vite entry (ARCHITECTURE §7/§8). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./providers.js";
import { AppShell } from "../ui/AppShell.js";
import "../ui/tokens.css";
import "../ui/styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <AppShell />
    </AppProviders>
  </StrictMode>,
);
