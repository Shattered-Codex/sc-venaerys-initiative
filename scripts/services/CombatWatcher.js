import { COMBATANT_FLAGS, MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { getSetting } from "../hooks/register-settings.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Keeps the combat tracker in step with what the core does not render by
 * itself: a done mark written without a render becomes a patch of the rows
 * involved (sidebar and popout), a setting or the GM's busy state asks for a
 * render, and the tracker comes forward when a phased combat starts (if this
 * user wants it). Combat and combatant changes are rendered by the core.
 */
export default class CombatWatcher {
  #render = false;
  #patches = new Set();

  constructor({ patchDone, requestFrame }) {
    this.patchDone = patchDone;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("render", () => this.flush()), { requestFrame });
  }

  static get tracker() {
    return globalThis.ui?.combat ?? null;
  }

  /** The tracker in its own window (the module's `open` API). */
  open() {
    return CombatWatcher.tracker?.renderPopout();
  }

  close() {
    return CombatWatcher.tracker?.popout?.close();
  }

  toggle() {
    return CombatWatcher.tracker?.popout?.rendered ? this.close() : this.open();
  }

  /** Brings the combat tab (or its popout) forward on this client. */
  show() {
    const tracker = CombatWatcher.tracker;
    if (!tracker) return;
    if (tracker.popout?.rendered) tracker.popout.bringToFront?.();
    else tracker.activate?.();
  }

  /** On `ready`: a phased combat already under way shows the tracker again after a reload. */
  openIfRunning() {
    const combat = game.combat;
    if (combat?.started && CombatSnapshot.isPhased(combat) && getSetting(SETTINGS.openOnStart)) this.show();
  }

  render() {
    this.#render = true;
    this.scheduler.schedule();
  }

  onUpdateCombat(combat) {
    const startedNow = combat.previous?.round === 0 && combat.round >= 1;
    if (startedNow && combat === game.combat && CombatSnapshot.isPhased(combat) && getSetting(SETTINGS.openOnStart)) this.show();
  }

  /** Only `done` changed: the rows can be patched instead of rendered. The server stamps `_stats` on every update. */
  static isDoneOnly(changes) {
    const keys = Object.keys(changes ?? {}).filter((key) => key !== "_id" && key !== "_stats");
    if (keys.length !== 1 || keys[0] !== "flags") return false;
    const scopes = Object.keys(changes.flags);
    const fields = Object.keys(changes.flags[MODULE_ID] ?? {});
    return scopes.length === 1 && fields.length === 1 && fields[0] === COMBATANT_FLAGS.done;
  }

  onUpdateCombatant(combatant, changes) {
    if (!CombatWatcher.isDoneOnly(changes) || combatant.parent !== CombatWatcher.tracker?.viewed) return;
    this.#patches.add(combatant.id);
    this.scheduler.schedule();
  }

  flush() {
    const render = this.#render;
    const patches = [...this.#patches];
    this.#render = false;
    this.#patches.clear();
    // The GM's panel reads the done marks too (phase complete), so the GM renders instead of patching.
    if (render || (patches.length && (game.user.isGM || !this.patchDone(patches)))) CombatWatcher.tracker?.render();
  }
}
