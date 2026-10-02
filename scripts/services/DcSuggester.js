import { COMBAT_FLAGS, DC_SOURCES, MODULE_ID } from "../constants/module-constants.js";
import { sameDc, suggestedDc } from "../helpers/dc-rules.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * The "Base + CR" DC, on the active GM. Before the start it follows the
 * combatants (entries, exits, defeats, enemies moved between phases); at the
 * start it freezes, and only "Recalculate" changes it again. A DC the GM
 * types turns the combat to "manual" and stops the following. `base()` gives
 * the current base setting.
 */
export default class DcSuggester {
  #queue = new Set();

  constructor({ adapter, classifier, base, requestFrame }) {
    this.adapter = adapter;
    this.classifier = classifier;
    this.base = base;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("dc-suggest", () => this.flush()), { requestFrame });
  }

  static #follows(combat) {
    return !!combat && game.user.isActiveGM && !(combat.round > 0) && CombatSnapshot.isPhased(combat)
      && CombatSnapshot.dcRuleOf(combat).source === DC_SOURCES.baseCr;
  }

  mark(combat) {
    if (!DcSuggester.#follows(combat)) return;
    this.#queue.add(combat.id);
    this.scheduler.schedule();
  }

  onCombatantChange(combatant) {
    this.mark(combatant.parent);
  }

  /** Phases turned on in round 0: the combatants that entered before count now. */
  onUpdateCombat(combat, changed) {
    if (foundry.utils.getProperty(changed, `flags.${MODULE_ID}.${COMBAT_FLAGS.enabled}`) === true) this.mark(combat);
  }

  async flush() {
    const ids = [...this.#queue];
    this.#queue.clear();
    for (const id of ids) {
      const combat = game.combats.get(id);
      if (!DcSuggester.#follows(combat)) continue;
      const suggestion = suggestedDc(CombatSnapshot.from(combat, this.adapter).combatants, this.base());
      if (!sameDc(CombatSnapshot.flagsOf(combat)[COMBAT_FLAGS.dc], suggestion)) await this.classifier.setDc(combat, suggestion);
    }
  }

  /** GM command "Recalculate": base + reference CR now, before or after the start. */
  async recalculate(combat) {
    if (!CombatSnapshot.isPhased(combat)) return;
    await this.classifier.setDc(combat, suggestedDc(CombatSnapshot.from(combat, this.adapter).combatants, this.base()));
  }
}
