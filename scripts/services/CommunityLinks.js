import { COMMUNITY_LINKS } from "../constants/community-links.js";
import { I18N_ROOT, MODULE_ID } from "../constants/module-constants.js";

const STRIP_CLASS = "svi-community-links";

/**
 * The module's outbound links (wiki, Patreon, Discord) as one compact strip
 * at the end of its own section in Foundry's settings window, the same strip
 * the other Shattered Codex modules show. Foundry renders one
 * `section[data-category="<module id>"]` per package, so the strip is
 * anchored there.
 */
export default class CommunityLinks {
  /** The links with their labels in the client's language. */
  static links(localize = (key) => game.i18n.localize(key)) {
    return COMMUNITY_LINKS.map((link) => ({
      ...link,
      label: localize(`${I18N_ROOT}.Links.${link.id}.Label`),
      hint: localize(`${I18N_ROOT}.Links.${link.id}.Hint`),
    }));
  }

  static open(url) {
    globalThis.window?.open?.(url, "_blank", "noopener");
  }

  /** Adds the strip to the module's settings section, once; `html` is the settings window's element (jQuery in older cores). */
  static inject(html) {
    const root = html?.jquery ? html[0] : html;
    const section = root?.matches?.(`[data-category="${MODULE_ID}"]`) ? root
      : root?.querySelector?.(`[data-category="${MODULE_ID}"]`) ?? root?.querySelector?.(`[data-tab="${MODULE_ID}"]`);
    if (!section || section.querySelector(`.${STRIP_CLASS}`)) return null;
    const strip = document.createElement("div");
    strip.className = `${MODULE_ID} ${STRIP_CLASS}`;
    strip.setAttribute("role", "group");
    strip.setAttribute("aria-label", game.i18n.localize(`${I18N_ROOT}.Links.Aria`));
    for (const link of CommunityLinks.links()) strip.append(CommunityLinks.#button(link));
    section.append(strip);
    return strip;
  }

  static #button(link) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `svi-community-link svi-community-link-${link.id}`;
    button.dataset.tooltip = link.hint;
    button.setAttribute("aria-label", link.hint);
    const icon = document.createElement("i");
    icon.className = link.icon;
    icon.inert = true;
    const label = document.createElement("span");
    label.textContent = link.label;
    button.append(icon, label);
    button.addEventListener("click", (event) => {
      // The settings form around it must not take the click as a submit.
      event.preventDefault();
      event.stopPropagation();
      CommunityLinks.open(link.url);
    });
    return button;
  }
}
