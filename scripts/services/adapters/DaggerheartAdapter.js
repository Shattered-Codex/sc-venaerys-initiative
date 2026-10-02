import { CRITICALS, NATURAL_RULES } from "../../constants/module-constants.js";
import SystemAdapter from "./SystemAdapter.js";

/**
 * Daggerheart has no initiative: its tracker passes the spotlight. The roll
 * against the DC is the module's own reaction roll, Hope die + Fear die +
 * Agility, read only for its total; matching dice are a critical (an
 * automatic success). It never gives Hope or Fear, nor touches the sheet.
 * Experimental: the system's spotlight moves turns and rounds on its own.
 */
export default class DaggerheartAdapter extends SystemAdapter {
  get hasSystemRoll() {
    return false;
  }

  get experimental() {
    return true;
  }

  settingDefaults() {
    return { natural20: NATURAL_RULES.autoSuccess, natural1: NATURAL_RULES.none };
  }

  defaultFormula() {
    return "1d12 + 1d12 + @system.traits.agility.value";
  }

  /** The two duality dice showing the same number. */
  criticalOf(roll) {
    const [hope, fear] = (roll?.dice ?? []).filter((term) => term.faces === 12);
    const value = (die) => die?.results?.find((result) => result.active !== false)?.result;
    return hope && fear && value(hope) === value(fear) ? CRITICALS.critical : null;
  }
}
