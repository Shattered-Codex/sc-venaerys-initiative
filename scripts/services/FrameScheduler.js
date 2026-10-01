/**
 * Coalesces bursts of hooks into one call on the next frame. A hidden tab
 * gets no animation frames, so it falls back to a short timer there: the
 * active GM's tab may well be in the background while the table plays.
 */
export default class FrameScheduler {
  #pending = false;

  constructor(callback, { requestFrame } = {}) {
    this.callback = callback;
    this.requestFrame = requestFrame ?? FrameScheduler.requestFrame;
  }

  get pending() {
    return this.#pending;
  }

  schedule() {
    if (this.#pending) return;
    this.#pending = true;
    this.requestFrame(() => {
      this.#pending = false;
      this.callback();
    });
  }

  static requestFrame(callback) {
    if (globalThis.document?.hidden || typeof globalThis.requestAnimationFrame !== "function") return setTimeout(callback, 16);
    return globalThis.requestAnimationFrame(callback);
  }
}
