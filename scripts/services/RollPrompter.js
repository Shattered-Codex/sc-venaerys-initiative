import { COMBAT_FLAGS, I18N_ROOT, MODULE_ID, PROMPT_IMAGES } from "../constants/module-constants.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";
import InitiativeRoller from "./InitiativeRoller.js";
import ThemeApplier from "./ThemeApplier.js";

/**
 * Asks a player to roll when a character of theirs is in the running phased
 * combat without a roll: when it joins, when the GM turns phases on, and
 * after a reload. Each character is asked about once per combat on this
 * client; "Later" leaves the roll button in the tracker. GMs are never asked.
 * The window shows who rolls (the token's picture or the sheet's portrait, as
 * the GM set) and the DC when the players may see it, instead of a sentence.
 */

const VIDEO = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;
const FALLBACK_IMAGE = "icons/svg/mystery-man.svg";
export default class RollPrompter {
  #asked = new Set();
  #queue = new Set();

  constructor({ roller, enabled, view = () => ({ showDc: false, image: PROMPT_IMAGES.token }), requestFrame }) {
    this.roller = roller;
    this.enabled = enabled;
    this.view = view;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("roll-prompt", () => this.flush()), { requestFrame });
  }

  queue(combat) {
    if (!combat || game.user.isGM || !this.enabled()) return;
    this.#queue.add(combat.id);
    this.scheduler.schedule();
  }

  onCreateCombatant(combatant) {
    this.queue(combatant.parent);
  }

  onUpdateCombat(combat, changed) {
    if (foundry.utils.getProperty(changed, `flags.${MODULE_ID}.${COMBAT_FLAGS.enabled}`) === true) this.queue(combat);
  }

  async flush() {
    const ids = [...this.#queue];
    this.#queue.clear();
    for (const id of ids) {
      const combat = game.combats.get(id);
      if (!combat || combat !== game.combat) continue;
      const waiting = InitiativeRoller.waiting(combat, { own: true }).filter((c) => c.visible && !this.#asked.has(`${id}:${c.id}`));
      if (!waiting.length) continue;
      for (const c of waiting) this.#asked.add(`${id}:${c.id}`);
      const ids = waiting.map((c) => c.id);
      if ((await this.ask(waiting.map((c) => c.name), combat, ids)) === "roll") await this.roller.roll(combat, ids);
    }
  }

  /** A still picture of one combatant: its token's or its sheet's, whichever the GM set; an animated token falls back to the sheet. */
  static imageOf(combatant, source) {
    const still = (src) => (typeof src === "string" && src && !VIDEO.test(src) ? src : null);
    const token = still(combatant?.token?.texture?.src) ?? still(combatant?.img);
    const portrait = still(combatant?.actor?.img);
    return (source === PROMPT_IMAGES.portrait ? portrait ?? token : token ?? portrait) ?? FALLBACK_IMAGE;
  }

  /** The DC as the tracker words it, or null when the players may not see it. */
  dcText(combat, showDc) {
    if (!showDc) return null;
    const dc = CombatSnapshot.dcOf(combat);
    const key = this.roller.adapter?.dcName?.(dc);
    return key
      ? game.i18n.format(`${I18N_ROOT}.Tracker.DcNamed`, { dc, name: game.i18n.localize(`${I18N_ROOT}.${key}`) })
      : game.i18n.format(`${I18N_ROOT}.Tracker.Dc`, { dc });
  }

  /** Resolves "roll" or "later"; closing the dialog is "later". */
  async ask(names, combat, ids) {
    const escape = (text) => foundry.utils.escapeHTML(String(text));
    const { showDc, image } = this.view();
    const dc = this.dcText(combat, showDc);
    const cards = ids.map((id, index) => {
      const src = RollPrompter.imageOf(combat.combatants.get(id), image);
      return `<li class="svi-roll-card"><img src="${escape(src)}" alt=""><span>${escape(names[index])}</span></li>`;
    });
    const choice = await foundry.applications.api.DialogV2.wait({
      classes: [MODULE_ID, "svi-dialog", "svi-roll-dialog"],
      window: { title: `${I18N_ROOT}.RollPrompt.Title`, icon: "fa-solid fa-dice-d20" },
      position: { width: 360 },
      content: `<ul class="svi-roll-cards">${cards.join("")}</ul>${dc ? `<p class="svi-roll-dc"><span class="svi-dc-badge">${escape(dc)}</span></p>` : ""}`,
      buttons: [
        { action: "roll", label: `${I18N_ROOT}.RollPrompt.Roll`, icon: "fa-solid fa-dice-d20", default: true },
        { action: "later", label: `${I18N_ROOT}.RollPrompt.Later`, icon: "fa-solid fa-clock" },
      ],
      rejectClose: false,
      render: (event, dialog) => ThemeApplier.apply(dialog.element),
    });
    return choice === "roll" ? "roll" : "later";
  }
}
