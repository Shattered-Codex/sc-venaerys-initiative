import { DC_RANGE, DC_SOURCES, NATURAL_RULES, ROLL_SOURCES, SETTINGS, SPLIT_MODES } from "./module-constants.js";
import { DEFAULT_PHASES } from "./default-phases.js";
import { normalizePlan } from "../helpers/phase-plan.js";
import { DEFAULT_THEME, THEMES, normalizeTheme } from "../helpers/themes.js";

/**
 * Tabs of the configuration screen, in rail order. `gm` tabs are hidden from
 * players; `settings` tabs list the schema entries whose `tab` names them.
 */
export const SETTING_TABS = Object.freeze([
  { id: "world", icon: "fa-solid fa-sliders", gm: true, settings: true },
  { id: "appearance", icon: "fa-solid fa-palette", gm: true, settings: true },
  { id: "phases", icon: "fa-solid fa-layer-group", gm: true, settings: false },
  { id: "client", icon: "fa-solid fa-user", gm: false, settings: true },
  { id: "help", icon: "fa-solid fa-circle-question", gm: true, settings: false },
].map(Object.freeze));

/** Sections inside a tab, in order. */
export const SETTING_SECTIONS = Object.freeze(["combat", "roll", "dc", "window", "theme"]);

/**
 * Every module setting, described once: it drives both registration and the
 * configuration screen. `tab` and `section` place it there; `tab: null` keeps
 * it off the generated rows (the Phases tab writes `phaseTemplate`). `react: "view"` re-projects the phase
 * window when the value changes.
 */
export const SETTINGS_SCHEMA = Object.freeze([
  { key: SETTINGS.enabledByDefault, scope: "world", type: "boolean", default: true, tab: "world", section: "combat", react: null },
  { key: SETTINGS.autoAdvance, scope: "world", type: "boolean", default: true, tab: "world", section: "combat", react: "view" },
  { key: SETTINGS.splitPhases, scope: "world", type: "choice", choices: Object.values(SPLIT_MODES), default: SPLIT_MODES.off, tab: "world", section: "combat", react: null },
  { key: SETTINGS.suggestFromSheet, scope: "world", type: "boolean", default: true, tab: "world", section: "combat", react: null },
  { key: SETTINGS.rollSource, scope: "world", type: "choice", choices: Object.values(ROLL_SOURCES), default: ROLL_SOURCES.system, tab: "world", section: "roll", react: null },
  // Empty means the system adapter's own default formula.
  { key: SETTINGS.rollFormula, scope: "world", type: "string", maxLength: 200, default: "", tab: "world", section: "roll", react: null },
  { key: SETTINGS.defaultDc, scope: "world", type: "number", range: { ...DC_RANGE, step: 1 }, default: 15, tab: "world", section: "dc", react: null },
  { key: SETTINGS.dcSource, scope: "world", type: "choice", choices: Object.values(DC_SOURCES), default: DC_SOURCES.manual, tab: "world", section: "dc", react: "view" },
  { key: SETTINGS.dcBase, scope: "world", type: "number", range: { min: 0, max: 30, step: 1 }, default: 10, tab: "world", section: "dc", react: null },
  { key: SETTINGS.showDcToPlayers, scope: "world", type: "boolean", default: false, tab: "world", section: "dc", react: "view" },
  { key: SETTINGS.natural20, scope: "world", type: "choice", choices: [NATURAL_RULES.none, NATURAL_RULES.autoSuccess, NATURAL_RULES.oneDegree], default: NATURAL_RULES.autoSuccess, tab: "world", section: "roll", react: null },
  { key: SETTINGS.natural1, scope: "world", type: "choice", choices: [NATURAL_RULES.none, NATURAL_RULES.autoFail, NATURAL_RULES.oneDegree], default: NATURAL_RULES.autoFail, tab: "world", section: "roll", react: null },
  { key: SETTINGS.openOnStart, scope: "client", type: "boolean", default: true, tab: "client", section: "window", react: null },
  { key: SETTINGS.rollPrompt, scope: "client", type: "boolean", default: true, tab: "client", section: "window", react: null },
  { key: SETTINGS.phaseTemplate, scope: "world", type: "array", default: DEFAULT_PHASES, tab: null, section: null, react: null },
  { key: SETTINGS.theme, scope: "world", type: "choice", choices: THEMES, default: DEFAULT_THEME, tab: "appearance", section: "theme", react: "theme" },
].map(Object.freeze));

export function schemaEntry(key) {
  return SETTINGS_SCHEMA.find((entry) => entry.key === key) ?? null;
}

/** Coerces a form or stored value into the setting's type; numbers stay inside their range. */
export function coerceSetting(entry, raw) {
  switch (entry.type) {
    case "boolean":
      return raw === true || raw === "true" || raw === "on";
    case "number": {
      const value = typeof raw === "string" && raw.trim() === "" ? NaN : Number(raw);
      if (!Number.isFinite(value)) return entry.default;
      const { min = -Infinity, max = Infinity } = entry.range ?? {};
      return Math.min(Math.max(Math.round(value), min), max);
    }
    case "string":
      return typeof raw === "string" ? raw.trim().slice(0, entry.maxLength ?? 200) : entry.default;
    case "choice":
      return entry.key === SETTINGS.theme ? normalizeTheme(raw) : entry.choices.includes(raw) ? raw : entry.default;
    case "array":
      return entry.key === SETTINGS.phaseTemplate ? normalizePlan(raw) : Array.isArray(raw) ? raw : entry.default;
    default:
      return raw;
  }
}
