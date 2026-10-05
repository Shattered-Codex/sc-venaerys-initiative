import { MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { CUSTOM_THEME, customThemeVariables, normalizeTheme } from "../helpers/themes.js";
import { customThemeColors, getSetting } from "../hooks/register-settings.js";

const CUSTOM_STYLE_ID = "svi-custom-theme";

/**
 * Stamps the world theme as `data-theme` on the module's own roots (never on
 * `<html>`, never on Foundry's elements). The "custom" theme's palette comes
 * from the GM's three colors, written as one rule in a `<style>` of the
 * module. The configuration screen can preview another theme, or other
 * custom colors, on this client only; ending the preview puts the saved ones
 * back.
 */
export default class ThemeApplier {
  static #preview = null;
  static #previewColors = null;

  static current() {
    return ThemeApplier.#preview ?? normalizeTheme(getSetting(SETTINGS.theme));
  }

  static apply(element, theme = ThemeApplier.current()) {
    if (element?.dataset) element.dataset.theme = theme;
  }

  /** Re-stamps every module root on screen (theme samples keep their own); runs when the setting or the preview changes. */
  static refresh(root = globalThis.document) {
    ThemeApplier.#writeCustomPalette();
    const theme = ThemeApplier.current();
    for (const element of root?.querySelectorAll?.(`.${MODULE_ID}:not([data-theme-fixed])`) ?? []) ThemeApplier.apply(element, theme);
  }

  static preview(theme) {
    ThemeApplier.#preview = normalizeTheme(theme);
    ThemeApplier.refresh();
  }

  /** Other colors for the custom theme, on this client only; `null` goes back to the saved ones. */
  static previewColors(colors) {
    ThemeApplier.#previewColors = colors;
    ThemeApplier.#writeCustomPalette();
  }

  static endPreview() {
    if (!ThemeApplier.previewing) return;
    ThemeApplier.#preview = null;
    ThemeApplier.#previewColors = null;
    ThemeApplier.refresh();
  }

  static get previewing() {
    return ThemeApplier.#preview !== null || ThemeApplier.#previewColors !== null;
  }

  /** The custom palette as the only rule of the module's own `<style>`, after the stylesheets so it wins over their fallback. */
  static #writeCustomPalette() {
    const head = globalThis.document?.head;
    if (!head) return;
    let style = head.querySelector(`#${CUSTOM_STYLE_ID}`);
    if (!style) {
      style = document.createElement("style");
      style.id = CUSTOM_STYLE_ID;
      head.append(style);
    }
    const variables = customThemeVariables(ThemeApplier.#previewColors ?? customThemeColors());
    const css = `.${MODULE_ID}[data-theme="${CUSTOM_THEME}"]{${Object.entries(variables).map(([name, value]) => `${name}:${value}`).join(";")}}`;
    if (style.textContent !== css) style.textContent = css;
  }
}
