/**
 * The suite's theme catalog, in the families of the SC puzzle engine's
 * picker. A theme only changes `--svi-*` values (styles/themes.css); `ember`
 * is the base block of styles/tokens.css.
 */

export const DEFAULT_THEME = "ember";

export const THEME_FAMILIES = Object.freeze([
  { id: "Dark", themes: ["ember", "verdant", "arcane", "tide", "forge", "ash", "midnight", "bloodmoon", "neon"] },
  { id: "Stone", themes: ["stoneforge", "catacomb", "sanctuary", "underworld", "moss"] },
  { id: "Light", themes: ["light", "sepia", "parchment"] },
  { id: "Scifi", themes: ["holo", "phosphor", "cyber", "hud"] },
  { id: "System", themes: ["dnd5e", "pf2e", "daggerheart", "coc7"] },
  { id: "Special", themes: ["contrast"] },
].map(Object.freeze));

export const THEMES = Object.freeze(THEME_FAMILIES.flatMap((family) => family.themes));

/** A stored value that is not a known theme reads as the default one. */
export function normalizeTheme(id) {
  return THEMES.includes(id) ? id : DEFAULT_THEME;
}
