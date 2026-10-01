import { COMBAT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import {
  automaticPhaseOf,
  classifyAll,
  classifyCleared,
  classifyCombatant,
  classifyForDc,
  classifyRoll,
} from "../helpers/phase-classifier.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Side, phase and display initiative of every combatant of a phased combat,
 * on the active GM: when it enters, when its initiative is rolled or cleared
 * ("Reset initiative" clears all of them through a Combat update), when the
 * DC changes and when the GM assigns a phase. Hook work waits for the next
 * frame: in the hook the core has not re-sorted the turns yet.
 */
export default class CombatantClassifier {
  #queue = new Map();

  constructor({ adapter, writer, requestFrame }) {
    this.adapter = adapter;
    this.writer = writer;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("classify", () => this.flush()), { requestFrame });
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
    if (options?.[OPERATION_KEY] || !("initiative" in changes) || !CombatantClassifier.#isActive(combat)) return;
    this.#enqueue(combat, [combatant.id], "roll");
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
      const changes = [];
      for (const [id, kind] of entries) {
        const combatant = view.combatants.find((c) => c.id === id);
        if (!combatant) continue;
        const change = CombatantClassifier.#classify(combatant, kind, view.dc);
        if (change) changes.push(change);
      }
      await this.writer.apply(combat, changes);
    }
  }

  static #classify(combatant, kind, dc) {
    if (kind === "entry" || !combatant.side) return classifyCombatant(combatant, dc);
    return Number.isFinite(combatant.initiative) ? classifyRoll(combatant, dc) : classifyCleared(combatant);
  }

  /** Classifies every combatant at once; runs when phases turn on, so none created earlier is missed. */
  async classifyAll(combat) {
    if (!CombatantClassifier.#isActive(combat)) return;
    await this.writer.apply(combat, classifyAll(CombatSnapshot.from(combat, this.adapter)));
  }

  /** GM command: a new DC for this combat; rolled, unpinned players follow it. */
  async setDc(combat, { value }) {
    const dc = Math.round(Number(value));
    if (!Number.isFinite(dc) || !CombatSnapshot.isPhased(combat)) return;
    await combat.update({ [`flags.${MODULE_ID}.${COMBAT_FLAGS.dc}`]: { value: dc, source: "manual" } }, { [OPERATION_KEY]: { reason: REASONS.dc } });
    await this.writer.apply(combat, classifyForDc(CombatSnapshot.from(combat, this.adapter), dc));
  }

  /** GM command: pins a combatant to a phase in this combat; `phaseId: null` is "Automatic". */
  async assign(combat, { combatantId, phaseId }) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const combatant = view.combatants.find((c) => c.id === combatantId);
    if (!view.enabled || !combatant) return;
    if (phaseId === null) {
      const target = automaticPhaseOf(combatant, view.dc, view.started);
      await this.writer.apply(combat, [{ id: combatantId, target }], { pinned: false });
      return;
    }
    if (!view.plan.some((phase) => phase.id === phaseId)) return;
    await this.writer.apply(combat, [{ id: combatantId, target: phaseId }], { pinned: true });
  }
}
