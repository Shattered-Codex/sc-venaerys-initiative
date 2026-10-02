import { COMBATANT_FLAGS, HALVES, MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import { canToggleDone, currentHalf, currentPhaseId, hasMoved, isSplitPhase } from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";

const DONE_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.done}`;
const MOVED_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.moved}`;

/**
 * Done marks: `done` holds the round in which a combatant finished its turn,
 * and `moved`, in a phase split into movement and actions, the round in
 * which it finished moving. The owner writes their own marks on their own
 * Combatant, any GM writes any mark directly: it is the combatant's data,
 * like its initiative, so it needs no socket and no active GM. "Skip this
 * round" is a done mark on a member of a phase still to come, and in a split
 * phase it marks both halves.
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
    const data = { [DONE_PATH]: value };
    if (isSplitPhase(view, target.phase)) {
      // Done includes having moved; undoing a skip of a phase still to come undoes both.
      if (done) data[MOVED_PATH] = view.round;
      else if (target.phase !== currentPhaseId(view)) data[MOVED_PATH] = null;
    }
    await combat.combatants.get(combatantId)?.update(data, DoneMarkers.options());
    return true;
  }

  /** Marks (`moved = true`) or unmarks a combatant's movement in a split phase; refused without permission. */
  async setMoved(combat, combatantId, moved) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const target = view.combatants.find((c) => c.id === combatantId);
    if (!canToggleDone(view, target, { isGM: game.user.isGM }) || !isSplitPhase(view, target.phase)) return false;
    if (moved === hasMoved(target, view.round)) return false;
    // Done counts as moved: unmarking the movement of someone skipped (done) clears both.
    const data = { [MOVED_PATH]: moved ? view.round : null };
    if (!moved && target.done === view.round) data[DONE_PATH] = null;
    await combat.combatants.get(combatantId)?.update(data, DoneMarkers.options());
    return true;
  }

  /**
   * A player's "end turn": marks their own combatants of the current phase
   * done, or moved in the movement half of a split phase. A GM owns
   * everyone, so for a GM "their own" are the combatants no player owns.
   */
  async markOwn(combat) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const current = currentPhaseId(view);
    if (current === null) return false;
    const mine = (c) => c.isOwner && !(game.user.isGM && c.hasPlayerOwner);
    return this.#mark(combat, view, view.combatants.filter((c) => mine(c) && c.phase === current && canToggleDone(view, c, { isGM: false })));
  }

  /** "Complete group": the GM marks every member of a group of the current phase done (or moved), defeated ones aside. */
  async markGroup(combat, combatantIds) {
    if (!game.user.isGM) return false;
    const view = CombatSnapshot.from(combat, this.adapter);
    const current = currentPhaseId(view);
    if (current === null) return false;
    const ids = new Set(combatantIds);
    return this.#mark(combat, view, view.combatants.filter((c) => ids.has(c.id) && c.phase === current && !c.isDefeated));
  }

  /** One batch for whoever has not finished the running half yet. */
  async #mark(combat, view, combatants) {
    const moving = currentHalf(view) === HALVES.move;
    const updates = combatants
      .filter((c) => (moving ? !hasMoved(c, view.round) : c.done !== view.round))
      .map((c) => ({ _id: c.id, [moving ? MOVED_PATH : DONE_PATH]: view.round }));
    if (!updates.length) return false;
    await combat.updateEmbeddedDocuments("Combatant", updates, DoneMarkers.options());
    return true;
  }
}
