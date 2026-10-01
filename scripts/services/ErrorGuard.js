import { I18N_ROOT, MODULE_ID } from "../constants/module-constants.js";

/**
 * A module error must never stop Foundry's own operation, the turn order or
 * the start of a combat. Every hook handler and method wrapper of the module
 * goes through here: the error is logged, the GM is told once per label per
 * session, and the native path carries on.
 */
export default class ErrorGuard {
  static #warned = new Set();

  /** Logs an error and warns the GM once for this label. */
  static report(label, error) {
    console.error(`${MODULE_ID} | ${label}`, error);
    if (!globalThis.game?.user?.isGM || ErrorGuard.#warned.has(label)) return;
    ErrorGuard.#warned.add(label);
    globalThis.ui?.notifications?.warn(game.i18n.localize(`${I18N_ROOT}.Notifications.Error`));
  }

  /**
   * Registers a hook handler that cannot throw into the core. The handler's
   * synchronous return value is passed through (pre-hooks cancel with
   * `false`); a failure returns undefined, which lets the operation go on.
   */
  static on(hookName, label, handler) {
    return Hooks.on(hookName, (...args) => ErrorGuard.#call(label, handler, undefined, args, () => undefined));
  }

  /**
   * Wraps a function so a failure, thrown or rejected, falls back to
   * `fallback` called with the same `this` and arguments.
   */
  static wrap(label, fn, fallback = () => undefined) {
    return function guarded(...args) {
      return ErrorGuard.#call(label, fn, this, args, fallback);
    };
  }

  static #call(label, fn, thisArg, args, fallback) {
    try {
      const result = fn.apply(thisArg, args);
      if (result && typeof result.then === "function") {
        return result.catch((error) => {
          ErrorGuard.report(label, error);
          return fallback.apply(thisArg, args);
        });
      }
      return result;
    } catch (error) {
      ErrorGuard.report(label, error);
      return fallback.apply(thisArg, args);
    }
  }

  /** Forgets which labels already warned; for tests. */
  static reset() {
    ErrorGuard.#warned.clear();
  }
}
