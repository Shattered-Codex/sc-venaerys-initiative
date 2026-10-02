import { COMBATANT_FLAGS, COMBAT_FLAGS, DC_RANGE, DC_SOURCES, MODULE_ID, OPERATION_KEY, REASONS, SIDES } from "../constants/module-constants.js";
import {
  automaticPhaseOf,
  classifyAll,
  classifyCleared,
  classifyCombatant,
  classifyForDc,
  classifyRoll,
  NO_NATURALS,
  sideFor,
} from "../helpers/phase-classifier.js";
import { canEnterPhase, displayName, phaseById } from "../helpers/phase-plan.js";
import { suggestedPhase } from "../helpers/sheet-suggestion.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Side, phase and display initiative of every combatant of a phased combat,
 * on the active GM: when it enters, when its initiative is rolled or cleared
 * ("Reset initiative" clears all of them through a Combat update), when the
 * natural d20 of its roll arrives, when the DC changes and when the GM
 * assigns a phase. Hook work waits for the next frame: in the hook the core
 * has not re-sorted the turns yet. `naturals()` gives the GM's current rules
 * for a natural 20 and 1; `suggestFromSheet()` whether an enemy's items may
 * suggest its phase (only when it is classified as a whole, never on a roll).
 */
export default class CombatantClassifier {
  #queue = new Map();

  constructor({ adapter, writer, naturals = () => NO_NATURALS, suggestFromSheet = () => false, requestFrame }) {
    this.adapter = adapter;
    this.writer = writer;
    this.naturals = naturals;
    this.suggestFromSheet = suggestFromSheet;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("classify", () => this.flush()), { requestFrame });
  }

  /** An enemy with the phase its sheet suggests, when the world uses the suggestion. */
  #withSuggestion(combat, plan, combatant) {
    if (!this.suggestFromSheet() || (combatant.side ?? sideFor(combatant)) !== SIDES.enemies) return combatant;
    const actor = combat.combatants.get(combatant.id)?.actor;
    const nameOf = (phase) => displayName(phase, (key) => game.i18n.localize(key));
    return { ...combatant, suggestedPhase: suggestedPhase(this.adapter.itemNames(actor), plan, nameOf) };
  }

  static #isActive(combat) {
    return game.user.isActiveGM && CombatSnapshot.isPhased(combat);
  }

  #enqueue(combat, ids, kind) {
    let entries = this.#queue.get(combat.id);
    if (!entries) this.#queue.set(combat.id, (entries = new Map()));
    for (const id of ids) {
      // An entry seen in the same frame as a roll still needs its side.
      if (entries.get(id) !== "entry") entries.set(id, kind);
    }
    this.scheduler.schedule();
  }

  onCreateCombatant(combatant) {
    const combat = combatant.parent;
    if (CombatantClassifier.#isActive(combat)) this.#enqueue(combat, [combatant.id], "entry");
  }

  onUpdateCombatant(combatant, changes, options) {
    const combat = combatant.parent;
    const natural = foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${COMBATANT_FLAGS.natural}`);
    const reason = options?.[OPERATION_KEY]?.reason;
    if (!natural && (reason || !("initiative" in changes))) return;
    if (natural && reason && reason !== REASONS.natural) return;
    if (CombatantClassifier.#isActive(combat)) this.#enqueue(combat, [combatant.id], "roll");
  }

  onUpdateCombat(combat, changed, options) {
    if (!game.user.isActiveGM) return;
    const enabledPath = `flags.${MODULE_ID}.${COMBAT_FLAGS.enabled}`;
    if (foundry.utils.getProperty(changed, enabledPath) === true) return this.classifyAll(combat);
    if (options?.[OPERATION_KEY] || !("combatants" in changed) || !CombatSnapshot.isPhased(combat)) return undefined;
    this.#enqueue(combat, combat.combatants.map((c) => c.id), "roll");
    return undefined;
  }

  async flush() {
    const queue = [...this.#queue];
    this.#queue.clear();
    for (const [combatId, entries] of queue) {
      const combat = game.combats.get(combatId);
      if (!combat || !CombatantClassifier.#isActive(combat)) continue;
      const view = CombatSnapshot.from(combat, this.adapter);
      const naturals = this.naturals();
      const changes = [];
      for (const [id, kind] of entries) {
        const combatant = view.combatants.find((c) => c.id === id);
        if (!combatant) continue;
        const whole = kind === "entry" || !combatant.side;
        const change = whole
          ? classifyCombatant(this.#withSuggestion(combat, view.plan, combatant), view.dc, naturals)
          : CombatantClassifier.#classifyRoll(combatant, view.dc, naturals);
        if (change) changes.push(change);
      }
      await this.writer.apply(combat, changes);
    }
  }

  static #classifyRoll(combatant, dc, naturals) {
    return Number.isFinite(combatant.initiative) ? classifyRoll(combatant, dc, naturals) : classifyCleared(combatant);
  }

  /** Classifies every combatant at once; runs when phases turn on, so none created earlier is missed. */
  async classifyAll(combat) {
    if (!CombatantClassifier.#isActive(combat)) return;
    const view = CombatSnapshot.from(combat, this.adapter);
    const combatants = view.combatants.map((combatant) => this.#withSuggestion(combat, view.plan, combatant));
    await this.writer.apply(combat, classifyAll({ ...view, combatants }, this.naturals()));
  }

  /**
   * GM command: a new DC for this combat; rolled, unpinned players follow it.
   * A typed DC is "manual"; a "Base + CR" one keeps its base and reference CR.
   */
  async setDc(combat, { value, source = DC_SOURCES.manual, base = null, referenceCr = null }) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number) || !CombatSnapshot.isPhased(combat)) return;
    const dc = Math.min(Math.max(number, DC_RANGE.min), DC_RANGE.max);
    const flag = source === DC_SOURCES.baseCr ? { value: dc, source, base, referenceCr } : { value: dc, source: DC_SOURCES.manual };
    await combat.update({ [`flags.${MODULE_ID}.${COMBAT_FLAGS.dc}`]: flag }, { [OPERATION_KEY]: { reason: REASONS.dc } });
    await this.writer.apply(combat, classifyForDc(CombatSnapshot.from(combat, this.adapter), dc, this.naturals()));
  }

  /** GM command: pins a combatant to a phase in this combat; `phaseId: null` is "Automatic". */
  async assign(combat, { combatantId, phaseId }) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const combatant = view.combatants.find((c) => c.id === combatantId);
    if (!view.enabled || !combatant) return;
    // Markers follow no rule: "Automatic" leaves them where they are.
    if (phaseId === null && combatant.side === SIDES.event) return;
    if (phaseId === null) {
      const target = automaticPhaseOf(this.#withSuggestion(combat, view.plan, combatant), view.dc, view.started, this.naturals());
      await this.writer.apply(combat, [{ id: combatantId, target }], { pinned: false });
      return;
    }
    if (!canEnterPhase(combatant, phaseById(view.plan, phaseId))) return;
    await this.writer.apply(combat, [{ id: combatantId, target: phaseId }], { pinned: true });
  }
}
