/**
 * Theme selection: hydrate the saved choice, apply it, persist changes.
 *
 * Applying is an effect on the id rather than something the picker does, so
 * every route to a theme change (the picker now, an installed theme later, a
 * restored session) goes through exactly one code path.
 */
import { useEffect } from "react";
import { useUi } from "../../app/store.js";
import { useServices } from "../../app/providers.js";
import { BUNDLED_THEMES, THEME_SETTING_KEY, applyTheme, getTheme, DEFAULT_THEME_ID } from "../theme/index.js";

/** Mounted once by the shell: hydrate from storage, then keep the DOM in sync. */
export function useThemeEffect(): void {
  const { repository } = useServices();
  const themeId = useUi((s) => s.themeId);
  const setThemeId = useUi((s) => s.setThemeId);

  useEffect(() => {
    let cancelled = false;
    void repository.getSetting<string>(THEME_SETTING_KEY, DEFAULT_THEME_ID).then((saved) => {
      // A theme that no longer exists (uninstalled, or a bundled id we dropped)
      // must fall back rather than leave the app unstyled — getTheme handles it,
      // but store the resolved id so the picker agrees with what's on screen.
      if (!cancelled) setThemeId(getTheme(saved).id);
    });
    return () => {
      cancelled = true;
    };
  }, [repository, setThemeId]);

  useEffect(() => {
    applyTheme(getTheme(themeId), document.documentElement);
  }, [themeId]);
}

export interface ThemePicker {
  themes: readonly { id: string; name: string; description: string }[];
  current: string;
  select: (id: string) => void;
}

export function useThemePicker(): ThemePicker {
  const { repository } = useServices();
  const current = useUi((s) => s.themeId);
  const setThemeId = useUi((s) => s.setThemeId);

  return {
    themes: BUNDLED_THEMES.map((t) => ({ id: t.id, name: t.name, description: t.description })),
    current,
    select: (id) => {
      setThemeId(id); // immediate, so the switch is felt on the same frame
      void repository.setSetting(THEME_SETTING_KEY, id);
    },
  };
}
