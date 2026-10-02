import { MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { normalizeTheme } from "../helpers/themes.js";
import { getSetting } from "../hooks/register-settings.js";

/**
 * Stamps the world theme as `data-theme` on the module's own roots (never on
 * `<html>`, never on Foundry's elements). The configuration screen can
 * preview another theme on this client only; ending the preview puts the
 * saved one back.
 */
export default class ThemeApplier {
  static #preview = null;

  static current() {
    return ThemeApplier.#preview ?? normalizeTheme(getSetting(SETTINGS.theme));
  }

  static apply(element, theme = ThemeApplier.current()) {
    if (element?.dataset) element.dataset.theme = theme;
  }

  /** Re-stamps every module root on screen (theme samples keep their own); runs when the setting or the preview changes. */
  static refresh(root = globalThis.document) {
    const theme = ThemeApplier.current();
    for (const element of root?.querySelectorAll?.(`.${MODULE_ID}:not([data-theme-fixed])`) ?? []) ThemeApplier.apply(element, theme);
  }

  static preview(theme) {
    ThemeApplier.#preview = normalizeTheme(theme);
    ThemeApplier.refresh();
  }

  static endPreview() {
    if (ThemeApplier.#preview === null) return;
    ThemeApplier.#preview = null;
    ThemeApplier.refresh();
  }

  static get previewing() {
    return ThemeApplier.#preview !== null;
  }
}
