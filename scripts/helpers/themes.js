/**
 * The Shattered Codex theme catalog, as SC Jump Scare ships it: three
 * families, dark ones over shared surfaces and light and stone ones with
 * surfaces of their own. A theme only changes `--svi-*` palette values
 * (styles/themes.css); `verdant` is the base block of styles/tokens.css.
 * The "custom" theme is the GM's own: three colors (accent, background,
 * text) from which the whole palette is derived.
 */

export const DEFAULT_THEME = "verdant";

export const THEME_FAMILIES = Object.freeze([
  { id: "Dark", themes: ["verdant", "ember", "arcane", "tide", "forge", "ash", "midnight", "bloodmoon"] },
  { id: "Light", themes: ["light", "sepia", "parchment"] },
  { id: "Stone", themes: ["stoneforge", "catacomb", "sanctuary", "underworld", "moss"] },
  { id: "Custom", themes: ["custom"] },
].map(Object.freeze));

export const CUSTOM_THEME = "custom";

/** The custom theme before the GM touches it: the colors of "verdant". */
export const CUSTOM_THEME_DEFAULTS = Object.freeze({ accent: "#1fa971", background: "#15181a", text: "#e6e8ea" });

const HEX = /^#[0-9a-f]{6}$/i;

/** A `#rrggbb` color in lower case, or `fallback`. */
export function normalizeColor(raw, fallback) {
  return typeof raw === "string" && HEX.test(raw.trim()) ? raw.trim().toLowerCase() : fallback;
}

const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

/** `amount` (0 to 1) of the way from one color to another. */
function mix(from, to, amount) {
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((value, i) => Math.round(value + (b[i] - value) * amount).toString(16).padStart(2, "0")).join("")}`;
}

/** Relative luminance (WCAG), 0 for black to 1 for white. */
function luminance(hex) {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The palette variables of the custom theme, from its three colors: the
 * surfaces and borders step from the background toward the text, the dimmer
 * texts step back toward the background, and the text over the accent is the
 * darker or lighter end, whichever reads better.
 */
export function customThemeVariables(colors = {}) {
  const accent = normalizeColor(colors.accent, CUSTOM_THEME_DEFAULTS.accent);
  const bg = normalizeColor(colors.background, CUSTOM_THEME_DEFAULTS.background);
  const text = normalizeColor(colors.text, CUSTOM_THEME_DEFAULTS.text);
  return {
    "--svi-accent": accent,
    "--svi-accent-soft": `${accent}22`,
    "--svi-accent-dim": mix(accent, bg, 0.55),
    "--svi-text-on-acc": luminance(accent) > 0.4 ? mix(accent, "#000000", 0.85) : mix(accent, "#ffffff", 0.92),
    "--svi-bg": bg,
    "--svi-bg-1": mix(bg, text, 0.04),
    "--svi-bg-2": mix(bg, text, 0.08),
    "--svi-bg-3": mix(bg, text, 0.13),
    "--svi-bg-hover": mix(bg, text, 0.16),
    "--svi-border": mix(bg, text, 0.15),
    "--svi-border-soft": mix(bg, text, 0.09),
    "--svi-border-strong": mix(bg, text, 0.3),
    "--svi-text": text,
    "--svi-text-dim": mix(text, bg, 0.35),
    "--svi-text-mute": mix(text, bg, 0.55),
  };
}

export const THEMES = Object.freeze(THEME_FAMILIES.flatMap((family) => family.themes));

/** Earlier theme IDs remain readable for worlds that saved them. */
export const LEGACY_THEMES = Object.freeze(["neon", "holo", "phosphor", "cyber", "hud", "dnd5e", "pf2e", "daggerheart", "coc7", "contrast"]);

export const isLegacyTheme = (id) => LEGACY_THEMES.includes(id);

/** A stored value that is not a known theme reads as the default one. */
export function normalizeTheme(id) {
  return THEMES.includes(id) || isLegacyTheme(id) ? id : DEFAULT_THEME;
}
