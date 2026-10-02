/**
 * The Shattered Codex theme catalog, as SC Jump Scare ships it: three
 * families, dark ones over shared surfaces and light and stone ones with
 * surfaces of their own. A theme only changes `--svi-*` palette values
 * (styles/themes.css); `verdant` is the base block of styles/tokens.css.
 */

export const DEFAULT_THEME = "verdant";

export const THEME_FAMILIES = Object.freeze([
  { id: "Dark", themes: ["verdant", "ember", "arcane", "tide", "forge", "ash", "midnight", "bloodmoon"] },
  { id: "Light", themes: ["light", "sepia", "parchment"] },
  { id: "Stone", themes: ["stoneforge", "catacomb", "sanctuary", "underworld", "moss"] },
].map(Object.freeze));

export const THEMES = Object.freeze(THEME_FAMILIES.flatMap((family) => family.themes));

/** Earlier theme IDs remain readable for worlds that saved them. */
export const LEGACY_THEMES = Object.freeze(["neon", "holo", "phosphor", "cyber", "hud", "dnd5e", "pf2e", "daggerheart", "coc7", "contrast"]);

export const isLegacyTheme = (id) => LEGACY_THEMES.includes(id);

/** A stored value that is not a known theme reads as the default one. */
export function normalizeTheme(id) {
  return THEMES.includes(id) || isLegacyTheme(id) ? id : DEFAULT_THEME;
}
