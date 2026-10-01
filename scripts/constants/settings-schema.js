import { DC_RANGE, SETTINGS } from "./module-constants.js";
import { DEFAULT_PHASES } from "./default-phases.js";
import { normalizePlan } from "../helpers/phase-plan.js";

/** Tabs of the configuration screen, in order. */
export const SETTING_TABS = Object.freeze(["general", "phases", "help"]);

/** Sections of the General tab, in order. */
export const SETTING_SECTIONS = Object.freeze(["combat", "dc", "window"]);

/**
 * Every module setting, described once: it drives both registration and the
 * General tab. `tab: null` keeps a setting off the generated form (the
 * Phases tab writes `phaseTemplate`). `react: "view"` re-projects the phase
 * window when the value changes.
 */
export const SETTINGS_SCHEMA = Object.freeze([
  { key: SETTINGS.enabledByDefault, scope: "world", type: "boolean", default: true, tab: "general", section: "combat", react: null },
  { key: SETTINGS.autoAdvance, scope: "world", type: "boolean", default: true, tab: "general", section: "combat", react: "view" },
  { key: SETTINGS.defaultDc, scope: "world", type: "number", range: { ...DC_RANGE, step: 1 }, default: 15, tab: "general", section: "dc", react: null },
  { key: SETTINGS.showDcToPlayers, scope: "world", type: "boolean", default: false, tab: "general", section: "dc", react: "view" },
  { key: SETTINGS.openOnStart, scope: "client", type: "boolean", default: true, tab: "general", section: "window", react: null },
  { key: SETTINGS.phaseTemplate, scope: "world", type: "array", default: DEFAULT_PHASES, tab: null, section: null, react: null },
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
    case "array":
      return entry.key === SETTINGS.phaseTemplate ? normalizePlan(raw) : Array.isArray(raw) ? raw : entry.default;
    default:
      return raw;
  }
}
