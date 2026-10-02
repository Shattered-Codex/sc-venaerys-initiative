import { PHASE_TYPES } from "../constants/module-constants.js";

const normalize = (text) => String(text ?? "").trim().toLocaleLowerCase();

/**
 * The phase the GM chose for a creature on its sheet, when the combat's plan
 * still has it as a creature phase; null otherwise, so a phase deleted from
 * the template sends the creature back to Enemies.
 */
export function chosenPhase(phaseId, plan) {
  if (typeof phaseId !== "string" || !phaseId) return null;
  return plan.some((phase) => phase.id === phaseId && phase.type === PHASE_TYPES.creatures) ? phaseId : null;
}

/**
 * The phase an enemy's sheet suggests: a creature phase whose name equals an
 * item name, whole and ignoring case. With several matches, the earliest
 * phase wins. This is only a default and never pins the combatant.
 * @param {string[]} itemNames names of the actor's items
 * @param {object[]} plan the combat's phases, in order
 * @param {(phase: object) => string} nameOf the phase's shown name
 * @returns {string|null} the suggested phase id
 */
export function suggestedPhase(itemNames, plan, nameOf) {
  const names = new Set((itemNames ?? []).map(normalize).filter(Boolean));
  if (!names.size) return null;
  const match = plan.find((phase) => phase.type === PHASE_TYPES.creatures && names.has(normalize(nameOf(phase))));
  return match?.id ?? null;
}
