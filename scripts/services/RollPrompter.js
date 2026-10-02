import { COMBAT_FLAGS, I18N_ROOT, MODULE_ID } from "../constants/module-constants.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";
import InitiativeRoller from "./InitiativeRoller.js";
import ThemeApplier from "./ThemeApplier.js";

/**
 * Asks a player to roll when a character of theirs is in the running phased
 * combat without a roll: when it joins, when the GM turns phases on, and
 * after a reload. Each character is asked about once per combat on this
 * client; "Later" leaves the roll button in the tracker. GMs are never asked.
 */
export default class RollPrompter {
  #asked = new Set();
  #queue = new Set();

  constructor({ roller, enabled, requestFrame }) {
    this.roller = roller;
    this.enabled = enabled;
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
      if ((await this.ask(waiting.map((c) => c.name))) === "roll") await this.roller.roll(combat, waiting.map((c) => c.id));
    }
  }

  /** Resolves "roll" or "later"; closing the dialog is "later". */
  async ask(names) {
    const escape = (text) => foundry.utils.escapeHTML(String(text));
    const choice = await foundry.applications.api.DialogV2.wait({
      classes: [MODULE_ID, "svi-roll-dialog"],
      window: { title: `${I18N_ROOT}.RollPrompt.Title`, icon: "fa-solid fa-dice-d20" },
      content: `<p>${game.i18n.format(`${I18N_ROOT}.RollPrompt.Body`, { names: names.map(escape).join(", ") })}</p>`,
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
