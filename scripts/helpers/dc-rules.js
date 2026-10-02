import { BUILTIN_PHASE_IDS, DC_RANGE, DC_SOURCES, SIDES } from "../constants/module-constants.js";
import { sideFor } from "./phase-classifier.js";

/**
 * The "Base + CR" DC: base plus the reference CR. The reference CR is the
 * highest CR among the enemies of the Enemies phase or, with nobody there,
 * among all enemies. Defeated enemies do not count; hidden ones do. A
 * fractional or missing CR counts 0.
 */

/** A CR as it counts for the DC: whole CRs; fractional, missing or invalid ones count 0. */
export function crValue(raw) {
  const value = Number(raw);
  return raw !== null && Number.isFinite(value) && value >= 1 ? Math.floor(value) : 0;
}

/** Enemies still in the fight; a side not written yet is worked out the same way the classifier does. */
function livingEnemies(combatants) {
  return combatants.filter((c) => !c.isDefeated && (c.side ?? sideFor(c)) === SIDES.enemies);
}

/** The reference CR, or null when no enemy counted has a CR at all. */
export function referenceCr(combatants) {
  const enemies = livingEnemies(combatants);
  // Enemies go to the Enemies phase unless the GM pinned them elsewhere.
  const inPhase = enemies.filter((c) => (c.nextPhase ?? c.phase ?? BUILTIN_PHASE_IDS.enemies) === BUILTIN_PHASE_IDS.enemies);
  const pool = inPhase.length ? inPhase : enemies;
  const known = pool.filter((c) => c.cr !== null && c.cr !== undefined);
  return known.length ? Math.max(...known.map((c) => crValue(c.cr))) : null;
}

/** The DC flag of a "Base + CR" combat, kept inside the DC range. */
export function suggestedDc(combatants, base) {
  const cr = referenceCr(combatants);
  const value = Math.min(Math.max(Math.round(base + (cr ?? 0)), DC_RANGE.min), DC_RANGE.max);
  return { value, source: DC_SOURCES.baseCr, base, referenceCr: cr };
}

/** Whether a stored "Base + CR" DC still matches what the combat suggests now. */
export function sameDc(stored, suggestion) {
  return stored?.source === suggestion.source
    && stored?.value === suggestion.value
    && stored?.base === suggestion.base
    && (stored?.referenceCr ?? null) === suggestion.referenceCr;
}
