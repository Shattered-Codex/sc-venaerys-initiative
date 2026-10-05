import { normalizeColor } from "./themes.js";

/**
 * The looks of a phase's "message on screen". The ready-made ones are drawn
 * by the stylesheet (styles/combat-tracker.css, one class each); "themed"
 * follows the module's theme and the phase's color. The GM's own banner
 * themes are five colors and the corner marks, saved in the world and
 * applied as the same `--svi-banner-*` variables the ready-made ones set.
 */

export const DEFAULT_BANNER_STYLE = "themed";

/** The ready-made looks, with the flat colors a copy of each starts from. */
export const BANNER_PRESETS = Object.freeze({
  themed: { line: "#1fa971", background: "#15181a", head: "#1b3a2e", title: "#e6e8ea", text: "#e6e8ea", corners: true },
  hud: { line: "#2ad4e6", background: "#122c3a", head: "#1f7b93", title: "#eafcff", text: "#cfeef5", corners: true },
  parchment: { line: "#8a6a3a", background: "#ead9b4", head: "#6b261d", title: "#f6e7c4", text: "#3a2a17", corners: true },
  blood: { line: "#b3261e", background: "#160606", head: "#5c0f0c", title: "#ffd9d4", text: "#f0c9c4", corners: true },
  arcane: { line: "#9d7bf0", background: "#18102c", head: "#5c3ab4", title: "#f1e9ff", text: "#dcd0f7", corners: true },
  frost: { line: "#a8d8f0", background: "#e2f0f8", head: "#4d8bb3", title: "#ffffff", text: "#1d3a4d", corners: true },
  minimal: { line: "#3a3a40", background: "#0c0c0e", head: "#0c0c0e", title: "#ffffff", text: "#d6d6da", corners: false },
});

export const BANNER_STYLES = Object.freeze(Object.keys(BANNER_PRESETS));

export const isBannerPreset = (id) => BANNER_STYLES.includes(id);

const COLOR_FIELDS = Object.freeze(["line", "background", "head", "title", "text"]);
export const BANNER_COLOR_FIELDS = COLOR_FIELDS;

/** One of the GM's banner themes with every field typed; null without an id of its own. */
export function normalizeBannerTheme(raw) {
  const id = typeof raw?.id === "string" ? raw.id.trim() : "";
  if (!id || isBannerPreset(id)) return null;
  const base = BANNER_PRESETS.themed;
  const theme = { id, name: String(raw.name ?? "").trim().slice(0, 60), corners: raw.corners !== false };
  for (const field of COLOR_FIELDS) theme[field] = normalizeColor(raw[field], base[field]);
  return theme;
}

/** The GM's banner themes, each id once. */
export function normalizeBannerThemes(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map(normalizeBannerTheme).filter((theme) => theme && !seen.has(theme.id) && seen.add(theme.id));
}

/** A new banner theme of the GM: a copy of a ready-made one, or of another of their own. */
export function copyBannerTheme(source, { id, name }) {
  return normalizeBannerTheme({ ...BANNER_PRESETS.themed, ...source, id, name });
}

/** The `--svi-banner-*` variables of one of the GM's banner themes. */
export function bannerVariables(theme) {
  return {
    "--svi-banner-line": theme.line,
    "--svi-banner-bg": theme.background,
    "--svi-banner-head": theme.head,
    "--svi-banner-title": theme.title,
    "--svi-banner-text": theme.text,
    "--svi-banner-corner": theme.corners ? theme.line : "transparent",
    "--svi-banner-glow": `0 0 18px ${theme.line}66, 0 10px 28px rgba(0, 0, 0, 0.5)`,
  };
}

/** How a message's style is drawn: a ready-made class, the GM's variables, or the module's theme when it is gone. */
export function resolveBannerStyle(style, themes) {
  if (isBannerPreset(style)) return { preset: style, variables: null };
  const custom = (themes ?? []).find((theme) => theme.id === style);
  return custom ? { preset: null, variables: bannerVariables(custom) } : { preset: DEFAULT_BANNER_STYLE, variables: null };
}
