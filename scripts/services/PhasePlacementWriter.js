import { MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import { planPlacement, pointerAfterMove } from "../helpers/phase-placement.js";
import CombatSnapshot from "./CombatSnapshot.js";

const FLAG_FIELDS = ["side", "phase", "nextPhase", "pinned"];

/**
 * Writes phase changes in one batch, following "never takes a turn, never
 * gives one". When the combatant under the pointer leaves the current phase,
 * that change goes in its own operation with an explicit `combatTurn`, so the
 * pointer stays in the current phase; if nobody would stay, the combat
 * advances first (`advance` is the PhaseAdvancer's, injected to close the
 * loop between the two).
 */
export default class PhasePlacementWriter {
  constructor({ adapter, advance }) {
    this.adapter = adapter;
    this.advance = advance;
  }

  /** `{id, data}` → a Combatant update with the module's flags under their namespace. */
  static toUpdate({ id, data }) {
    const update = { _id: id };
    if ("initiative" in data) update.initiative = data.initiative;
    for (const field of FLAG_FIELDS) {
      if (field in data) update[`flags.${MODULE_ID}.${field}`] = data[field];
    }
    return update;
  }

  static options(extra = {}) {
    return { ...extra, [OPERATION_KEY]: { reason: REASONS.placement } };
  }

  /** Applies `{id, target?, side?, initiative?}` changes; `pinned` marks a GM assignment. */
  async apply(combat, changes, { pinned = false, retried = false } = {}) {
    if (!changes.length) return;
    const plan = planPlacement(CombatSnapshot.from(combat, this.adapter), changes, { pinned });
    if (plan.updates.length) {
      await combat.updateEmbeddedDocuments("Combatant", plan.updates.map(PhasePlacementWriter.toUpdate), PhasePlacementWriter.options());
    }
    if (!plan.pointer) return;
    const move = pointerAfterMove(CombatSnapshot.from(combat, this.adapter), plan.pointer.data.phase);
    if (move.advanceFirst && !retried) {
      await this.advance(combat, { force: true });
      const change = changes.find((c) => c.id === plan.pointer.id);
      return this.apply(combat, [change], { pinned, retried: true });
    }
    // Still the pointer after advancing (nowhere to go): move it and let re-anchoring settle the pointer.
    const extra = move.advanceFirst ? {} : { combatTurn: move.combatTurn, turnEvents: false };
    await combat.updateEmbeddedDocuments("Combatant", [PhasePlacementWriter.toUpdate(plan.pointer)], PhasePlacementWriter.options(extra));
  }
}
