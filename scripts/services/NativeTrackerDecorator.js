import { I18N_ROOT, MODULE_ID } from "../constants/module-constants.js";

/**
 * A "Phases" button in the native combat tracker's header that opens the
 * phase window. Added after every tracker render, once.
 */
export default class NativeTrackerDecorator {
  constructor({ open }) {
    this.open = open;
  }

  onRender(app, element) {
    const root = element instanceof HTMLElement ? element : element?.[0];
    const header = root?.querySelector(".combat-tracker-header");
    if (!header || !app.viewed || header.querySelector(".svi-tracker-bar")) return;
    const bar = document.createElement("div");
    bar.className = `${MODULE_ID} svi-tracker-bar`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "svi-tracker-button";
    button.setAttribute("aria-label", game.i18n.localize(`${I18N_ROOT}.Tracker.OpenLabel`));
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-layer-group";
    icon.inert = true;
    const label = document.createElement("span");
    label.textContent = game.i18n.localize(`${I18N_ROOT}.Tracker.OpenButton`);
    button.append(icon, label);
    button.addEventListener("click", () => this.open());
    bar.append(button);
    header.append(bar);
  }
}
