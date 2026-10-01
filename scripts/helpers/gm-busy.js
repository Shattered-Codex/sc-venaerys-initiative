/**
 * Pure rules of "the active GM is in the middle of something": an open
 * dialog holds the automatic advance, and it only fires after two "free"
 * reads in a row, so chained dialogs (attack, then damage) do not let it slip
 * through the gap between them.
 */

/** The main menu (Esc) is a dialog too, but never a reason to wait. */
const MAIN_MENU_ID = "menu";

/** Any dialog-tagged application, or an instance of one of the given classes (absent classes are skipped). */
export function isBusyApp(app, busyClasses = []) {
  if (!app || app.id === MAIN_MENU_ID) return false;
  if (app.options?.tag === "dialog") return true;
  return busyClasses.some((cls) => typeof cls === "function" && app instanceof cls);
}

export function isBusy({ apps = [], busyClasses = [], legacyWindows = [], LegacyDialog = null }) {
  for (const app of apps) if (isBusyApp(app, busyClasses)) return true;
  if (typeof LegacyDialog !== "function") return false;
  return legacyWindows.some((app) => app instanceof LegacyDialog);
}

export const FREE_READS_TO_FIRE = 2;

/** Next state of the "free in a row" counter; `fire` once it reaches the threshold. */
export function nextFreeCount(count, busy) {
  const next = busy ? 0 : count + 1;
  return { count: next, fire: next >= FREE_READS_TO_FIRE };
}
