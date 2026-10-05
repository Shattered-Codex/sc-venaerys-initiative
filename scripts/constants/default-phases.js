import { BUILTIN_PHASE_IDS, I18N_ROOT, PHASE_TYPES } from "./module-constants.js";

/**
 * What every phase does when it starts unless the GM changes it: a message
 * on screen with no text of its own, which shows the phase's name.
 */
const ANNOUNCE = Object.freeze([
  Object.freeze({ id: "announce", kind: "screenMessage", enabled: true, params: Object.freeze({ text: "", audience: "all", style: "themed", seconds: 4 }) }),
]);

/**
 * The phase template of a new world. Names are i18n keys with `name: null`:
 * Foundry has no world language, so each client shows them in its own.
 */
export const DEFAULT_PHASES = Object.freeze([
  { id: "epicBoss", type: PHASE_TYPES.creatures, nameKey: `${I18N_ROOT}.Phase.EpicBoss`, name: null, icon: "fa-solid fa-dragon", color: "#c9503c" },
  { id: "boss", type: PHASE_TYPES.creatures, nameKey: `${I18N_ROOT}.Phase.Boss`, name: null, icon: "fa-solid fa-crown", color: "#d68a3a" },
  { id: "miniBoss", type: PHASE_TYPES.creatures, nameKey: `${I18N_ROOT}.Phase.MiniBoss`, name: null, icon: "fa-solid fa-skull", color: "#c9b23c" },
  { id: BUILTIN_PHASE_IDS.fast, type: PHASE_TYPES.fast, nameKey: `${I18N_ROOT}.Phase.Fast`, name: null, icon: "fa-solid fa-bolt", color: "#5b86c9" },
  { id: BUILTIN_PHASE_IDS.enemies, type: PHASE_TYPES.enemies, nameKey: `${I18N_ROOT}.Phase.Enemies`, name: null, icon: "fa-solid fa-users", color: "#b56fb0" },
  { id: BUILTIN_PHASE_IDS.slow, type: PHASE_TYPES.slow, nameKey: `${I18N_ROOT}.Phase.Slow`, name: null, icon: "fa-solid fa-hourglass-half", color: "#3fa3a0" },
  // Only combats where the GM adds an event marker ever stop here; the rest skip it.
  { id: "lair", type: PHASE_TYPES.event, nameKey: `${I18N_ROOT}.Phase.Lair`, name: null, icon: "fa-solid fa-chess-rook", color: "#9184d9" },
].map((phase) => Object.freeze({ ...phase, onEnter: ANNOUNCE })));

/** What "Add phase" creates; the id comes from the caller. */
export const NEW_PHASE = Object.freeze({
  type: PHASE_TYPES.creatures,
  nameKey: `${I18N_ROOT}.Phase.New`,
  name: null,
  icon: "fa-solid fa-flag",
  color: "#6fa35a",
  onEnter: ANNOUNCE,
});

/** What "Add event phase" creates; the id comes from the caller. */
export const NEW_EVENT_PHASE = Object.freeze({
  type: PHASE_TYPES.event,
  nameKey: `${I18N_ROOT}.Phase.NewEvent`,
  name: null,
  icon: "fa-solid fa-wand-sparkles",
  color: "#9184d9",
  onEnter: ANNOUNCE,
});

/** A fresh, mutable copy of the default template. */
export function defaultPlan() {
  return DEFAULT_PHASES.map((phase) => structuredClone(phase));
}
