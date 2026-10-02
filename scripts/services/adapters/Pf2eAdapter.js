import { NATURAL_RULES } from "../../constants/module-constants.js";
import SystemAdapter from "./SystemAdapter.js";

/**
 * Pathfinder 2e: initiative is the statistic the sheet picked (Perception by
 * default), with its own modifiers dialog. A natural 20 or 1 moves the result
 * one degree, as in any check. When a GM rolls for players the dialog is
 * skipped: the GM is not the one choosing their modifiers.
 */
export default class Pf2eAdapter extends SystemAdapter {
  settingDefaults() {
    return { natural20: NATURAL_RULES.oneDegree, natural1: NATURAL_RULES.oneDegree };
  }

  defaultFormula() {
    return "1d20 + @actor.initiative.mod";
  }

  rollInitiative(combat, combatantIds, { forOthers = false } = {}) {
    return combat.rollInitiative(combatantIds, forOthers ? { skipDialog: true } : {});
  }
}
