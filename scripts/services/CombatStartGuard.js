import { BUILTIN_PHASE_IDS, I18N_ROOT, MODULE_ID, OPERATION_KEY } from "../constants/module-constants.js";
import { displayName, phaseById } from "../helpers/phase-plan.js";
import { startConfirmation, startNeedsConfirmation } from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import ThemeApplier from "./ThemeApplier.js";

/**
 * Asks the GM before a phased combat starts with players who have not rolled,
 * when starting now would skip ahead of their first phase. The question comes
 * before any effect of the start: no sound, no `combatStart` hook, no system
 * recovery runs until the GM chooses "Start anyway". It wraps the final
 * Combat class at `setup`, above the system's own override.
 */
export default class CombatStartGuard {
  #pending = new Map();
  #installed = null;

  constructor({ adapter, roller = null }) {
    this.adapter = adapter;
    this.roller = roller;
  }

  install() {
    const proto = CONFIG.Combat.documentClass.prototype;
    const original = proto.startCombat;
    const guard = this;
    this.#installed = ErrorGuard.wrap(
      "startCombat",
      function guardedStart(...args) {
        return guard.start(this, original, args);
      },
      original,
    );
    proto.startCombat = this.#installed;
  }

  /** A Combat class registered after `setup` escapes the wrapper; say so in the console. */
  check() {
    if (CONFIG.Combat.documentClass.prototype.startCombat === this.#installed) return true;
    console.warn(`${MODULE_ID} | The Combat class changed after setup: the start confirmation is not active.`);
    return false;
  }

  start(combat, original, args) {
    const confirmed = args[0]?.[OPERATION_KEY]?.confirmed === true;
    if (!game.user.isGM || combat.started || confirmed || !CombatSnapshot.isPhased(combat)) return original.apply(combat, args);
    const view = CombatSnapshot.from(combat, this.adapter);
    if (!startNeedsConfirmation(view)) return original.apply(combat, args);
    // One question per combat: the dock does not disable its start button while it waits.
    if (this.#pending.has(combat.id)) return this.#pending.get(combat.id);
    // "Roll for them" rolls and does not start: the new rolls are placed first, then the GM starts.
    const answer = this.ask(view)
      .then(async (choice) => {
        if (choice === "roll") await this.roller?.rollAll(combat);
        return choice === "start" ? original.apply(combat, args) : combat;
      })
      .finally(() => this.#pending.delete(combat.id));
    this.#pending.set(combat.id, answer);
    return answer;
  }

  /** Resolves "start", "roll" or "wait"; closing the dialog (or Esc) waits. */
  async ask(view) {
    const localize = (key) => game.i18n.localize(key);
    const format = (key, data) => game.i18n.format(`${I18N_ROOT}.Start.${key}`, data);
    const name = (id) => foundry.utils.escapeHTML(displayName(phaseById(view.plan, id), localize));
    const phases = { fast: name(BUILTIN_PHASE_IDS.fast), slow: name(BUILTIN_PHASE_IDS.slow) };
    const info = startConfirmation(view);
    const names = info.names.map((n) => foundry.utils.escapeHTML(n));
    if (info.more) names.push(format("More", { count: info.more }));
    const one = info.count === 1;
    const paragraphs = [
      `<p class="svi-start-lead">${format(one ? "PendingOne" : "PendingMany", { count: info.count, names: names.join(", ") })}</p>`,
      `<p>${format(one ? "IfStartOne" : "IfStartMany", phases)}</p>`,
    ];
    if (info.fastEmpty) paragraphs.push(`<p class="svi-start-note">${format("FastEmpty", phases)}</p>`);
    const choice = await foundry.applications.api.DialogV2.wait({
      classes: [MODULE_ID, "svi-dialog", "svi-start-dialog"],
      window: { title: `${I18N_ROOT}.Start.Title`, icon: "fa-solid fa-swords" },
      content: paragraphs.join(""),
      buttons: [
        { action: "start", label: `${I18N_ROOT}.Start.StartAnyway`, icon: "fa-solid fa-play", default: info.defaultAction === "start" },
        { action: "wait", label: `${I18N_ROOT}.Start.Wait`, icon: "fa-solid fa-hourglass-half", default: info.defaultAction === "wait" },
        ...(this.roller ? [{ action: "roll", label: `${I18N_ROOT}.Start.RollForThem`, icon: "fa-solid fa-dice-d20" }] : []),
      ],
      rejectClose: false,
      render: (event, dialog) => ThemeApplier.apply(dialog.element),
    });
    return choice === "start" || choice === "roll" ? choice : "wait";
  }
}
