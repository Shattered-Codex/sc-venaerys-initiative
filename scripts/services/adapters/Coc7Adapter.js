import { CRITICALS, NATURAL_RULES } from "../../constants/module-constants.js";
import SystemAdapter from "./SystemAdapter.js";

const SYSTEM_ID = "CoC7";
const DIFFICULTIES = ["Any", "Regular", "Hard", "Extreme", "Critical"];

/**
 * Call of Cthulhu 7e. With the system's optional initiative rule, each
 * investigator rolls DEX and the system writes the success level as the
 * initiative (fumble -99, failure 0, regular 1, hard 2, extreme 3, critical 4,
 * plus DEX/100). The DC is then the difficulty the Keeper asks for: 1
 * Regular, 2 Hard, 3 Extreme. The basic rule rolls nothing (initiative is
 * DEX), so the GM is told to switch rules or use a formula. The default
 * formula is the margin of a DEX roll: it passes a DC of 0 when d100 <= DEX.
 */
export default class Coc7Adapter extends SystemAdapter {
  settingDefaults() {
    return { defaultDc: 1, natural20: NATURAL_RULES.none, natural1: NATURAL_RULES.none };
  }

  defaultFormula() {
    return "@characteristics.dex.value - 1d100";
  }

  dcName(dc) {
    const name = DIFFICULTIES[dc];
    return name ? `Roll.Difficulty.${name}` : null;
  }

  systemRollProblem() {
    let rule = null;
    try {
      rule = game.settings.get(SYSTEM_ID, "initiativeRule");
    } catch {
      return null;
    }
    return rule === "optional" ? null : "Roll.CocBasicRule";
  }

  /** In a formula, the d100 reads 01 as a critical and 100 as a fumble; the system's own roll has them in its level already. */
  criticalOf(roll) {
    const die = roll?.dice?.find((term) => term.faces === 100);
    const value = die?.results?.find((result) => result.active !== false)?.result;
    if (value === 1) return CRITICALS.critical;
    return value === 100 ? CRITICALS.fumble : null;
  }
}
