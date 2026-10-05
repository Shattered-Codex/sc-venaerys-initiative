import { isEventPhase, phaseRank } from "./phase-plan.js";
import { currentPhaseId, isPending } from "./phase-progression.js";

/**
 * What one user may see of a phased combat, decided before any template.
 * Players see exactly the combatants the core tracker shows them (the
 * combatant's own `visible`, never re-derived from `hidden`). A phase with no
 * visible member disappears for them, except the current one, which shows as
 * "Waiting for the GM" with no name and no members. The GM sees everything;
 * with `hideEmptyPhases`, the GM's empty phases disappear too, except the
 * event phases, whose "+" is the only way to put a marker in them.
 */

function phaseState(view, rank, currentRank) {
  if (!view.started || currentRank === null) return "future";
  if (rank < currentRank) return "past";
  return rank === currentRank ? "current" : "future";
}

/**
 * @returns {{showDc: boolean, phases: Array<{phase?: object, state: string, members?: object[], waitingForGm: boolean}>, pending: object[]}}
 */
export function visibleCombat(view, { isGM, showDcToPlayers, hideEmptyPhases = false }) {
  const current = currentPhaseId(view);
  const currentRank = current === null ? null : phaseRank(view.plan, current);
  const sees = (combatant) => isGM || combatant.visible;
  const phases = [];
  view.plan.forEach((phase, rank) => {
    const state = phaseState(view, rank, currentRank);
    const members = view.combatants.filter((c) => c.phase === phase.id && sees(c));
    if (members.length || (isGM && (!hideEmptyPhases || isEventPhase(phase)))) phases.push({ phase, state, members, waitingForGm: false });
    else if (state === "current") phases.push({ state, waitingForGm: true });
  });
  return {
    showDc: isGM || !!showDcToPlayers,
    phases,
    pending: view.combatants.filter((c) => isPending(c) && sees(c)),
  };
}
