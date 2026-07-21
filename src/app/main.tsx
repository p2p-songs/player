/** Vite entry (ARCHITECTURE §7/§8). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProviders } from "./providers.js";
import { installTrustedTypesFallback } from "./security/trusted-types.js";
import { ErrorBoundary } from "../ui/components/ErrorBoundary.js";
import { AppShell } from "../ui/AppShell.js";
import "../ui/tokens.css";
import "../ui/styles.css";

// §6a: under the production CSP's `require-trusted-types-for 'script'`, establish
// a single named policy so any (unexpected) sink use is funneled and auditable,
// rather than silently succeeding. No-op where Trusted Types is unavailable.
installTrustedTypesFallback();

const container = document.getElementById("root");
if (!container) throw new Error("#root not found");

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </ErrorBoundary>
  </StrictMode>,
);
