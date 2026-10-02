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

  /** A done mark is patched into the tracker rows, so it asks the core for no render. */
  static options() {
    return { render: false, [OPERATION_KEY]: { reason: REASONS.done } };
  }

  /** Marks (`done = true`) or unmarks a combatant; refused without permission. */
  async setDone(combat, combatantId, done) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const target = view.combatants.find((c) => c.id === combatantId);
    if (!canToggleDone(view, target, { isGM: game.user.isGM })) return false;
    const value = done ? view.round : null;
    if (target.done === value) return false;
    await combat.combatants.get(combatantId)?.update({ [DONE_PATH]: value }, DoneMarkers.options());
    return true;
  }

  /**
   * A player's "end turn": marks their own combatants of the current phase
   * done. A GM owns everyone, so for a GM "their own" are the combatants no
   * player owns.
   */
  async markOwn(combat) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const current = currentPhaseId(view);
    if (current === null) return false;
    const mine = (c) => c.isOwner && !(game.user.isGM && c.hasPlayerOwner);
    return this.#mark(combat, view, view.combatants.filter((c) => mine(c) && c.phase === current && canToggleDone(view, c, { isGM: false })));
  }

  /** "Complete group": the GM marks every member of a group of the current phase done, defeated ones aside. */
  async markGroup(combat, combatantIds) {
    if (!game.user.isGM) return false;
    const view = CombatSnapshot.from(combat, this.adapter);
    const current = currentPhaseId(view);
    if (current === null) return false;
    const ids = new Set(combatantIds);
    return this.#mark(combat, view, view.combatants.filter((c) => ids.has(c.id) && c.phase === current && !c.isDefeated));
  }

  /** One batch of done marks for whoever is not done yet. */
  async #mark(combat, view, combatants) {
    const updates = combatants.filter((c) => c.done !== view.round).map((c) => ({ _id: c.id, [DONE_PATH]: view.round }));
    if (!updates.length) return false;
    await combat.updateEmbeddedDocuments("Combatant", updates, DoneMarkers.options());
    return true;
  }
}
