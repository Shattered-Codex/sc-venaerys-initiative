import { MODULE_ID, STYLESHEETS } from "../constants/module-constants.js";

/**
 * Adds the module's stylesheets to the page, unlayered. Foundry puts the
 * stylesheets of a manifest into its `modules` cascade layer, and any
 * unlayered rule beats every layered one, whatever its specificity: a UI
 * theme that injects its own sheet (Carolingian UI does) would restyle the
 * module's controls. Unlayered, the module's own rules win by their weight.
 * The version in the URL keeps a browser from serving last release's sheet.
 */
export default class StyleLoader {
  /** Once, at init: the module's own version stamps the URLs. */
  static install() {
    return StyleLoader.inject({ version: globalThis.game?.modules?.get(MODULE_ID)?.version ?? "" });
  }

  static inject({ version = "" } = {}) {
    const head = globalThis.document?.head;
    if (!head) return [];
    return STYLESHEETS.map((file, index) => {
      const id = `${MODULE_ID}-style-${index}`;
      const existing = head.querySelector(`link#${id}`);
      if (existing) return existing;
      const link = globalThis.document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `modules/${MODULE_ID}/${file}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
      head.append(link);
      return link;
    });
  }
}
