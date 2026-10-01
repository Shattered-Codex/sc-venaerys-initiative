import { COMBATANT_FLAGS, MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { getSetting } from "../hooks/register-settings.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Keeps the phase window in step with the combat on every client: bursts of
 * combat hooks become one render on the next frame, a change of nothing but
 * done marks becomes a patch of the rows involved, the window opens when a
 * phased combat starts (if this user wants it) and closes when its combat is
 * deleted.
 */
export default class CombatWatcher {
  #full = false;
  #header = false;
  #patches = new Set();
  #app = null;

  constructor({ createApp, requestFrame }) {
    this.createApp = createApp;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("render", () => this.flush()), { requestFrame });
  }

  get app() {
    return this.#app;
  }

  open() {
    this.#app ??= this.createApp();
    return this.#app.render({ force: true });
  }

  close() {
    return this.#app?.rendered ? this.#app.close() : undefined;
  }

  toggle() {
    return this.#app?.rendered ? this.close() : this.open();
  }

  /** On `ready`: a phased combat already under way reopens the window after a reload. */
  openIfRunning() {
    const combat = game.combat;
    if (combat?.started && CombatSnapshot.isPhased(combat) && getSetting(SETTINGS.openOnStart)) this.open();
  }

  render({ headerOnly = false } = {}) {
    if (headerOnly) this.#header = true;
    else this.#full = true;
    this.scheduler.schedule();
  }

  onUpdateCombat(combat, changed) {
    const startedNow = combat.previous?.round === 0 && combat.round >= 1;
    if (startedNow && combat === game.combat && CombatSnapshot.isPhased(combat) && getSetting(SETTINGS.openOnStart) && !this.#app?.rendered) {
      this.open();
      return;
    }
    this.render();
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
    if (!CombatWatcher.isDoneOnly(changes)) return this.render();
    this.#patches.add(combatant.id);
    this.scheduler.schedule();
    return undefined;
  }

  onDeleteCombat(combat) {
    if (this.#app?.combatId === combat.id) this.close();
  }

  flush() {
    const app = this.#app;
    const full = this.#full;
    const header = this.#header;
    const patches = [...this.#patches];
    this.#full = false;
    this.#header = false;
    this.#patches.clear();
    if (!app?.rendered) return;
    if (full || (patches.length && !app.patchDone(patches))) {
      app.render();
      return;
    }
    // The GM's panel reads the done marks too (phase complete, advance waiting).
    if (header || (patches.length && game.user.isGM)) app.render({ parts: ["header"] });
  }
}
