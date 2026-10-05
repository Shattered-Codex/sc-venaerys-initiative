import { phaseById } from "../helpers/phase-plan.js";
import { currentPhaseId } from "../helpers/phase-progression.js";
import { silencesTheme } from "../helpers/phase-sound.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";

/**
 * The core plays its combat theme ("your turn", "next up") whenever the turn
 * pointer moves, so a phase that starts would be heard. A phase is silent
 * unless the GM chose the core's sound for it; a silent phase, or one with a
 * file of its own, keeps the core quiet while the combat is in it, by
 * wrapping `Combat#_playCombatSound` on every client. The start of the
 * encounter and combats without phases are never touched. Installed at
 * `setup`, when the system's Combat class is final.
 */
export default class PhaseSoundGuard {
  constructor({ adapter }) {
    this.adapter = adapter;
  }

  install() {
    const proto = CONFIG.Combat.documentClass.prototype;
    const original = proto._playCombatSound;
    if (typeof original !== "function") return;
    const guard = this;
    function phasedSound(announcement) {
      if (announcement !== "startEncounter" && guard.silences(this)) return undefined;
      return original.call(this, announcement);
    }
    proto._playCombatSound = ErrorGuard.wrap("phase-sound", phasedSound, original);
  }

  /** Whether the phase the combat is in keeps the core's turn sounds quiet. */
  silences(combat) {
    if (!CombatSnapshot.isPhased(combat)) return false;
    const view = CombatSnapshot.from(combat, this.adapter);
    return silencesTheme(phaseById(view.plan, currentPhaseId(view)));
  }
}
