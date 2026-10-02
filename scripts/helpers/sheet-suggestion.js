import { PHASE_TYPES } from "../constants/module-constants.js";

/**
 * The phase an enemy's sheet suggests: a creature phase whose name equals the
 * name of one of the actor's items, whole and ignoring case ("Boss" suggests
 * Boss; "Boss Fight" suggests nothing). With several matches, the earliest
 * phase of the plan wins. The suggestion is only a default: it never pins.
 */

const normalize = (text) => String(text ?? "").trim().toLocaleLowerCase();

/**
 * @param {string[]} itemNames                 names of the actor's items
 * @param {object[]} plan                      the combat's phases, in order
 * @param {(phase: object) => string} nameOf   the phase's shown name
 * @returns {string|null}                      the suggested phase id
 */
export function suggestedPhase(itemNames, plan, nameOf) {
  const names = new Set((itemNames ?? []).map(normalize).filter(Boolean));
  if (!names.size) return null;
  const match = plan.find((phase) => phase.type === PHASE_TYPES.creatures && names.has(normalize(nameOf(phase))));
  return match?.id ?? null;
}
