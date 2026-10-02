import { COMBATANT_FLAGS, MARKER_IMG, MODULE_ID, OPERATION_KEY, REASONS, SIDES } from "../constants/module-constants.js";
import { displayName, isEventPhase, phaseById } from "../helpers/phase-plan.js";
import CombatSnapshot from "./CombatSnapshot.js";

/**
 * Event markers: a combatant with no actor and no token that the GM adds to
 * an event phase (lair actions, a collapsing bridge, a ritual). It holds its
 * phase like anyone else, so an event phase without a marker is skipped and
 * one with a marker waits for the GM to mark it done. It never rolls: its
 * initiative is a fixed 0, so "Roll All" passes it by.
 */
export default class EventMarkers {
  /** GM command, on the active GM: one new marker in an event phase of the combat, named after the phase. */
  async add(combat, { phaseId }) {
    const plan = CombatSnapshot.planOf(combat);
    const phase = plan ? phaseById(plan, phaseId) : null;
    if (!isEventPhase(phase)) return null;
    const data = {
      name: displayName(phase, (key) => game.i18n.localize(key)),
      img: MARKER_IMG,
      initiative: 0,
      flags: { [MODULE_ID]: { [COMBATANT_FLAGS.side]: SIDES.event, [COMBATANT_FLAGS.phase]: phaseId, [COMBATANT_FLAGS.pinned]: true } },
    };
    const [created] = await combat.createEmbeddedDocuments("Combatant", [data], { [OPERATION_KEY]: { reason: REASONS.marker } });
    return created ?? null;
  }
}
