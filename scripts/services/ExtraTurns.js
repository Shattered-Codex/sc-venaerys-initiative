import { COMBATANT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS, SIDES } from "../constants/module-constants.js";
import { extraTurnChanges } from "../helpers/extra-turns.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Keeps the extra turns of a critical in step with the combat, on the active
 * GM and once per frame: one per critical player in the rounds the GM's option
 * gives them (a combatant of its own for the same token, pinned to the other
 * players' phase), none in the others. `rounds()` reads the GM's option.
 */
export default class ExtraTurns {
  #dirty = new Set();
  #running = false;

  constructor({ adapter, rounds, requestFrame }) {
    this.adapter = adapter;
    this.rounds = rounds;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("extra-turns", () => this.flush()), { requestFrame });
  }

  /**
   * A change that may add, move or remove an extra turn; the module's own
   * extra-turn writes are skipped. A combat out of phases is marked too: its
   * extra turns must go, or the core's tracker gives the player two turns.
   */
  mark(combat, options = null) {
    if (options?.[OPERATION_KEY]?.reason === REASONS.extraTurn) return;
    if (!combat || !game.user.isActiveGM) return;
    this.#dirty.add(combat.id);
    this.scheduler.schedule();
  }

  /** The option changed, or this client just became the active GM. */
  markAll() {
    for (const combat of game.combats ?? []) this.mark(combat);
  }

  /**
   * One pass at a time: a pass that read the combat before another one's
   * creation landed would create the same extra turn again. Marks made while
   * a pass runs wait in the set, and the running pass takes them when it ends.
   */
  async flush() {
    if (this.#running) return;
    this.#running = true;
    try {
      while (this.#dirty.size) {
        const ids = [...this.#dirty];
        this.#dirty.clear();
        for (const id of ids) {
          const combat = game.combats.get(id);
          // eslint-disable-next-line no-await-in-loop
          if (combat && game.user.isActiveGM) await this.reconcile(combat);
        }
      }
    } finally {
      this.#running = false;
    }
  }

  async reconcile(combat) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const { create, update, remove } = extraTurnChanges(view, { rounds: this.rounds() });
    const options = { [OPERATION_KEY]: { reason: REASONS.extraTurn } };
    if (remove.length) await combat.deleteEmbeddedDocuments("Combatant", remove, options);
    if (create.length) await combat.createEmbeddedDocuments("Combatant", create.map((entry) => ExtraTurns.#data(combat, entry)), options);
    if (update.length) await combat.updateEmbeddedDocuments("Combatant", update.map(ExtraTurns.#update), options);
  }

  /** The same token as the original, so its owner marks it done and the token is highlighted on its turn. */
  static #data(combat, { originId, phase, initiative }) {
    const origin = combat.combatants.get(originId);
    return {
      tokenId: origin.tokenId,
      sceneId: origin.sceneId,
      actorId: origin.actorId,
      hidden: origin.hidden,
      defeated: !!origin.defeated,
      initiative,
      flags: {
        [MODULE_ID]: {
          [COMBATANT_FLAGS.side]: SIDES.players,
          [COMBATANT_FLAGS.phase]: phase,
          [COMBATANT_FLAGS.pinned]: true,
          [COMBATANT_FLAGS.extraTurnOf]: originId,
        },
      },
    };
  }

  static #update({ id, phase, nextPhase, initiative, hidden, defeated }) {
    const update = { _id: id };
    if (phase !== undefined) update[`flags.${MODULE_ID}.${COMBATANT_FLAGS.phase}`] = phase;
    if (nextPhase !== undefined) update[`flags.${MODULE_ID}.${COMBATANT_FLAGS.nextPhase}`] = nextPhase;
    if (initiative !== undefined) update.initiative = initiative;
    if (hidden !== undefined) update.hidden = hidden;
    if (defeated !== undefined) update.defeated = defeated;
    return update;
  }
}
