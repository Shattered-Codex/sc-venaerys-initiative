import { CRITICALS } from "../../constants/module-constants.js";
import ErrorGuard from "../ErrorGuard.js";
import SystemAdapter from "./SystemAdapter.js";

/**
 * dnd5e: enemies show their initiative score, so the system groups identical
 * creatures and never asks them to roll. The CR is an NPC's
 * `system.details.cr`; the natural d20 is the kept die of a `D20Roll` (a
 * fixed initiative score has none). The default formula adds the whole
 * initiative bonus. Read by feature, not by version.
 */
export default class Dnd5eAdapter extends SystemAdapter {
  /**
   * dnd5e 6 builds a combatant's grouping keys from its token without a
   * guard, which throws for a marker while rendering groups and on "Roll
   * All"; both versions update the actor of every combatant at each turn's
   * recovery, which throws for a marker and stops the recovery of everyone
   * after it. Markers get no grouping key and no recovery.
   */
  guardEventMarkers(isMarker) {
    super.guardEventMarkers(isMarker);
    const proto = CONFIG.Combatant?.documentClass?.prototype;
    for (const method of ["getGroupingKey", "getInitiativeGroupingKey"]) {
      const original = proto?.[method];
      if (typeof original !== "function") continue;
      proto[method] = function markerSafeGroupingKey(...args) {
        return isMarker(this) ? null : original.apply(this, args);
      };
    }
    ErrorGuard.on("dnd5e.preCombatRecovery", "marker-recovery", (combatant) => (isMarker(combatant) ? false : undefined));
  }

  defaultFormula() {
    return "1d20 + @attributes.init.total";
  }

  displayInitiative(combatant) {
    const score = Number(combatant?.actor?.system?.attributes?.init?.score);
    return Number.isFinite(score) ? score : 0;
  }

  challengeRating(actor) {
    if (actor?.type !== "npc") return null;
    const cr = actor.system?.details?.cr;
    return cr === null || cr === undefined || !Number.isFinite(Number(cr)) ? null : Number(cr);
  }

  /** The system's own roll keeps its d20 apart; a formula roll is read like any other. */
  criticalOf(roll) {
    if (!roll?.validD20Roll) return super.criticalOf(roll);
    const value = Number(roll.d20?.total);
    if (value === 20) return CRITICALS.critical;
    return value === 1 ? CRITICALS.fumble : null;
  }
}
