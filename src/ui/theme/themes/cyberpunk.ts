/** Cyberpunk Pirate Radio — the deliberate stress test. It is the first theme
 *  with a **dark content canvas**, so every place the stylesheet quietly assumed
 *  a light surface (a hardcoded white, a tint that only works on cream) shows up
 *  here as unreadable text. It is also the only theme that uses `--glow` and
 *  shouted labels, which is why both are tokens rather than component styles. */
import type { Theme } from "../contract.js";

export const cyberpunk: Theme = {
  id: "cyberpunk",
  name: "Cyberpunk Pirate Radio",
  description: "Dark deck, neon magenta, shouted labels.",
  scheme: "dark",
  tokens: {
    "--chrome-bg": "#08070c",
    "--chrome-bg-raised": "#151221",
    "--chrome-text": "#f2ecff",
    "--chrome-text-muted": "#8d84a8",
    "--chrome-border": "#2a2340",

    "--bg": "#0b0912",
    "--surface": "#14111f",
    "--surface-sunken": "#1c1830",
    "--text": "#f2ecff",
    "--text-muted": "#9b93b5",
    "--border": "#2f2748",

    "--accent": "#ff2d78",
    "--accent-hover": "#ff5c95",
    "--accent-soft": "#2e0f22",
    "--on-accent": "#0b0912",
    "--accent-2": "#24d8ff",
    "--on-accent-2": "#0b0912",

    "--warn": "#ffc53d",
    "--danger": "#ff4d5e",
    "--alert-bg": "#26101c",

    "--font-display": '"Chakra Petch", "Rajdhani", ui-monospace, "SF Mono", Menlo, monospace',
    "--font-body": 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    "--font-mono": 'ui-monospace, "SF Mono", Menlo, monospace',
    "--text-xs": "10px",
    "--text-sm": "12px",
    "--text-md": "13px",
    "--text-lg": "15px",
    "--text-xl": "21px",
    "--text-2xl": "28px",
    "--weight-body": "400",
    "--weight-medium": "600",
    "--weight-bold": "700",
    "--weight-display": "700",
    "--tracking-display": "0.2em",
    "--tracking-label": "0.14em",
    "--label-case": "uppercase",

    "--radius": "3px",
    "--radius-lg": "5px",
    "--radius-pill": "999px",
    "--radius-round": "50%",
    "--border-width": "1px",
    "--border-width-thick": "2px",

    "--shadow": "0 0 0 1px rgb(255 45 120 / 12%), 0 8px 24px rgb(0 0 0 / 60%)",
    "--shadow-lg": "0 0 0 1px rgb(255 45 120 / 20%), 0 18px 48px rgb(0 0 0 / 75%)",
    "--glow": "0 0 14px rgb(255 45 120 / 55%)",

    "--focus-ring": "2px solid #24d8ff",
    "--focus-offset": "2px",

    "--motion-fast": "110ms ease-out",

    "--sidebar-w": "208px",
    "--player-h": "78px",

    "--art-fallback": "radial-gradient(circle at 40% 35%, #ff2d78 0%, #6a1038 55%, #0b0912 100%)",
  },
};
