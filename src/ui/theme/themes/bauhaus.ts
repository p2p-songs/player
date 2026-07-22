/** Bauhaus Hi-Fi — flat, square, primary. Everything a theme can do *without*
 *  colour is doing the work here: zero radius, no shadow at all, geometric
 *  display face, sentence case. If this reads as "Espresso in red", the token
 *  vocabulary is too narrow. */
import type { Theme } from "../contract.js";

export const bauhaus: Theme = {
  id: "bauhaus",
  name: "Bauhaus Hi-Fi",
  description: "Flat primaries, hard edges, geometric type.",
  scheme: "light",
  tokens: {
    "--chrome-bg": "#121212",
    "--chrome-bg-raised": "#232323",
    "--chrome-text": "#f5f3ee",
    "--chrome-text-muted": "#9b9691",
    "--chrome-border": "#2e2e2e",

    "--bg": "#f4f1ea",
    "--surface": "#ffffff",
    "--surface-sunken": "#eae6dc",
    "--text": "#111111",
    "--text-muted": "#5c574f",
    "--border": "#d5d0c4",

    "--accent": "#e63329",
    "--accent-hover": "#c22a21",
    "--accent-soft": "#fadedb",
    "--on-accent": "#ffffff",
    "--accent-2": "#1b4f9c",
    "--on-accent-2": "#ffffff",

    "--warn": "#f2c300",
    "--danger": "#e63329",
    "--alert-bg": "#fdf3d4",

    "--font-display": '"Futura", "Avenir Next", "Century Gothic", "Poppins", ui-sans-serif, system-ui, sans-serif',
    "--font-body": '"Avenir Next", "Helvetica Neue", ui-sans-serif, system-ui, sans-serif',
    "--font-mono": "ui-monospace, SFMono-Regular, Menlo, monospace",
    "--text-xs": "11px",
    "--text-sm": "12px",
    "--text-md": "13px",
    "--text-lg": "16px",
    "--text-xl": "22px",
    "--text-2xl": "30px",
    "--weight-body": "400",
    "--weight-medium": "500",
    "--weight-bold": "700",
    "--weight-display": "700",
    "--tracking-display": "0.02em",
    "--tracking-label": "0",
    "--label-case": "none",

    // Flat and square: the shadow tokens are `none`, not "subtle".
    "--radius": "0px",
    "--radius-lg": "0px",
    "--radius-pill": "0px",
    "--radius-round": "50%", // the transport button stays a circle — a Bauhaus primitive
    "--border-width": "1px",
    "--border-width-thick": "3px",

    "--shadow": "none",
    "--shadow-lg": "none",
    "--glow": "none",

    "--focus-ring": "3px solid #1b4f9c",
    "--focus-offset": "1px",

    "--motion-fast": "90ms linear",

    "--sidebar-w": "212px",
    "--player-h": "76px",

    "--art-fallback": "linear-gradient(135deg, #e63329 0% 50%, #1b4f9c 50% 100%)",
  },
};
