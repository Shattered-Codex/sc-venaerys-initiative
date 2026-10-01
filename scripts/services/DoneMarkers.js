import { COMBATANT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import { canToggleDone, currentPhaseId } from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";

const DONE_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.done}`;

/**
 * Done marks: `done` holds the round in which a combatant finished its turn.
 * The owner writes their own mark on their own Combatant, any GM writes any
 * mark directly: it is the combatant's data, like its initiative, so it needs
 * no socket and no active GM. "Skip this round" is a done mark on a member of
 * a phase still to come.
 */
export default class DoneMarkers {
  constructor({ adapter }) {
    this.adapter = adapter;
  }

  /** Marks (`done = true`) or unmarks a combatant; refused without permission. */
  async setDone(combat, combatantId, done) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const target = view.combatants.find((c) => c.id === combatantId);
    if (!canToggleDone(view, target, { isGM: game.user.isGM })) return false;
    const value = done ? view.round : null;
    if (target.done === value) return false;
    await combat.combatants.get(combatantId)?.update({ [DONE_PATH]: value }, { [OPERATION_KEY]: { reason: REASONS.done } });
    return true;
  }

  /** A player's "end turn": marks their own combatants of the current phase done. */
  async markOwn(combat) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const current = currentPhaseId(view);
    if (current === null) return false;
    const updates = view.combatants
      .filter((c) => c.isOwner && c.phase === current && c.done !== view.round && canToggleDone(view, c, { isGM: false }))
      .map((c) => ({ _id: c.id, [DONE_PATH]: view.round }));
    if (!updates.length) return false;
    await combat.updateEmbeddedDocuments("Combatant", updates, { [OPERATION_KEY]: { reason: REASONS.done } });
    return true;
  }
}
