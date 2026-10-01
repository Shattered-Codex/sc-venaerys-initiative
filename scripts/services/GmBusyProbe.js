import { BUSY_POLL_MS } from "../constants/module-constants.js";
import { isBusy, nextFreeCount } from "../helpers/gm-busy.js";

/**
 * "Is the active GM in the middle of something?" An automatic advance waits
 * while the GM has a dialog open (rolls, activity use, manual dice, midi-qol
 * reactions), and fires after two free reads in a row. It only polls while an
 * advance waits. There is no timeout: a forgotten dialog holds the advance,
 * the phase window says so, and "Next phase" by hand never waits.
 */
export default class GmBusyProbe {
  #waiting = new Map();
  #freeCount = 0;
  #timer = null;

  constructor({ onChange = () => {}, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.onChange = onChange;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
  }

  /** Application classes that count as busy even without the dialog tag; absent ones are skipped. */
  static busyClasses() {
    return [
      foundry.applications.api?.DialogV2,
      foundry.applications.dice?.RollResolver,
      globalThis.MidiQOL?.apps?.ReactionDialog,
      globalThis.MidiQOL?.apps?.RollModifyDialog,
    ];
  }

  isBusy() {
    return isBusy({
      apps: [...(foundry.applications.instances?.values() ?? [])],
      busyClasses: GmBusyProbe.busyClasses(),
      legacyWindows: Object.values(globalThis.ui?.windows ?? {}),
      LegacyDialog: foundry.appv1?.api?.Dialog ?? null,
    });
  }

  isWaiting(combatId) {
    return this.#waiting.has(combatId);
  }

  /** Runs `fire` now when the GM is free, else once the GM has been free for two reads in a row. */
  request(combatId, fire) {
    if (!this.#waiting.size && !this.isBusy()) return fire();
    const wasWaiting = this.#waiting.has(combatId);
    this.#waiting.set(combatId, fire);
    if (!this.#timer) {
      this.#freeCount = 0;
      this.#schedule();
    }
    if (!wasWaiting) this.onChange(combatId);
    return undefined;
  }

  cancel(combatId) {
    if (!this.#waiting.delete(combatId)) return;
    if (!this.#waiting.size) this.#stop();
    this.onChange(combatId);
  }

  /** A dialog closed: read again now instead of waiting for the next poll. */
  poke() {
    if (this.#waiting.size) this.#read();
  }

  #schedule() {
    this.#timer = this.setTimer(() => {
      this.#timer = null;
      this.#read();
    }, BUSY_POLL_MS);
  }

  #read() {
    const { count, fire } = nextFreeCount(this.#freeCount, this.isBusy());
    this.#freeCount = count;
    if (!fire) {
      if (!this.#timer) this.#schedule();
      return;
    }
    const waiting = [...this.#waiting];
    this.#waiting.clear();
    this.#stop();
    for (const [combatId, callback] of waiting) {
      this.onChange(combatId);
      callback();
    }
  }

  #stop() {
    if (this.#timer) this.clearTimer(this.#timer);
    this.#timer = null;
    this.#freeCount = 0;
  }
}
