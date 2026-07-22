/** Dark (Espresso) — the original reference theme: dark chrome, warm cream
 *  content, burnt-orange accent. Kept as the default so an existing install
 *  looks unchanged. */
import type { Theme } from "../contract.js";

export const espresso: Theme = {
  id: "espresso",
  name: "Dark (Espresso)",
  description: "Warm cream canvas, dark chrome, burnt orange.",
  scheme: "light",
  tokens: {
    "--chrome-bg": "#17120f",
    "--chrome-bg-raised": "#211a15",
    "--chrome-text": "#ece4d8",
    "--chrome-text-muted": "#9d9184",
    "--chrome-border": "#2c231d",

    "--bg": "#faf6ee",
    "--surface": "#ffffff",
    "--surface-sunken": "#f2ebdd",
    "--text": "#241d18",
    "--text-muted": "#6f6357",
    "--border": "#e4dac8",

    "--accent": "#e2622a",
    "--accent-hover": "#c9531f",
    "--accent-soft": "#fbe7db",
    "--on-accent": "#ffffff",
    "--accent-2": "#c9a227",
    "--on-accent-2": "#241d18",

    "--warn": "#e2a32a",
    "--danger": "#d1442f",
    "--alert-bg": "#fff3ec",

    "--font-display": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-body": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
    "--text-xs": "11px",
    "--text-sm": "12px",
    "--text-md": "13px",
    "--text-lg": "15px",
    "--text-xl": "20px",
    "--text-2xl": "26px",
    "--weight-body": "400",
    "--weight-medium": "600",
    "--weight-bold": "700",
    "--weight-display": "800",
    "--tracking-display": "0.14em",
    "--tracking-label": "0.01em",
    "--label-case": "none",

    "--radius": "8px",
    "--radius-lg": "12px",
    "--radius-pill": "999px",
    "--radius-round": "50%",
    "--border-width": "1px",
    "--border-width-thick": "2px",

    "--shadow": "0 1px 2px rgb(36 29 24 / 8%), 0 4px 12px rgb(36 29 24 / 6%)",
    "--shadow-lg": "0 4px 10px rgb(36 29 24 / 10%), 0 16px 32px rgb(36 29 24 / 8%)",
    "--glow": "none",

    "--focus-ring": "2px solid #e2622a",
    "--focus-offset": "2px",

    "--motion-fast": "120ms ease",

    "--sidebar-w": "208px",
    "--player-h": "76px",

    "--art-fallback": "linear-gradient(135deg, #e2622a 0%, #8c2f10 100%)",
  },
};
