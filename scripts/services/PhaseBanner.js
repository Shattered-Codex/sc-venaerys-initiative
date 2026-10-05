import { MODULE_ID } from "../constants/module-constants.js";
import { DEFAULT_BANNER_STYLE, resolveBannerStyle } from "../helpers/banner-themes.js";
import { bannerThemes } from "../hooks/register-settings.js";
import ThemeApplier from "./ThemeApplier.js";

const FADE_MS = 300;

/**
 * A phase's "message on screen": the phase's name on a title band and the
 * GM's text under it, across the top of the screen for a few seconds. Its
 * look is the banner theme the GM chose for that message: a ready-made one,
 * or one of the GM's own ("themed" follows the module's theme and the
 * phase's color). `themes` shows unsaved ones, for the configuration
 * screen's preview. Each client draws its own; nothing goes over the
 * network. A click dismisses it.
 */
export default class PhaseBanner {
  static #host = null;

  static show({ title, text, icon, color, style = DEFAULT_BANNER_STYLE, seconds = 6, themes = null }) {
    if (!globalThis.document?.body) return;
    const banner = document.createElement("div");
    const look = resolveBannerStyle(style, themes ?? bannerThemes());
    banner.className = look.preset ? `svi-banner svi-banner-${look.preset}` : "svi-banner";
    for (const [name, value] of Object.entries(look.variables ?? {})) banner.style.setProperty(name, value);
    banner.setAttribute("role", "status");
    if (color) banner.style.setProperty("--svi-phase-color", color);
    const heading = document.createElement("span");
    heading.className = "svi-banner-title";
    if (icon) {
      const glyph = document.createElement("i");
      glyph.className = icon;
      glyph.inert = true;
      heading.append(glyph);
    }
    heading.append(title);
    banner.append(heading);
    // With no text the banner only announces the phase.
    if (text) {
      const body = document.createElement("p");
      body.className = "svi-banner-text";
      body.textContent = text;
      banner.append(body);
    }
    PhaseBanner.#ensureHost().append(banner);
    const dismiss = () => {
      banner.classList.remove("svi-shown");
      setTimeout(() => banner.remove(), FADE_MS);
    };
    banner.addEventListener("click", dismiss);
    requestAnimationFrame(() => banner.classList.add("svi-shown"));
    setTimeout(dismiss, seconds * 1000);
  }

  static #ensureHost() {
    if (!PhaseBanner.#host?.isConnected) {
      PhaseBanner.#host = document.createElement("div");
      PhaseBanner.#host.className = `${MODULE_ID} svi-banner-host`;
      document.body.append(PhaseBanner.#host);
    }
    ThemeApplier.apply(PhaseBanner.#host);
    return PhaseBanner.#host;
  }
}
