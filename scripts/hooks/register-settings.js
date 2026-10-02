import { I18N_ROOT, MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { SETTINGS_SCHEMA, coerceSetting, schemaEntry } from "../constants/settings-schema.js";

const TYPES = { boolean: Boolean, number: Number, array: Array, choice: String, string: String };

/**
 * Registers every setting of SETTINGS_SCHEMA. None shows in the core menu:
 * they live in the module's own configuration screen, opened by
 * `SettingsMenu`. `onViewChange` re-projects the phase window and
 * `onThemeChange` re-stamps the theme. `defaults` are the running system's
 * own defaults (a Call of Cthulhu DC is a difficulty level, not 15).
 */
export function registerSettings({ onViewChange, onThemeChange, SettingsMenu, defaults = {} }) {
  const reactions = { view: onViewChange, theme: onThemeChange };
  for (const entry of SETTINGS_SCHEMA) {
    game.settings.register(MODULE_ID, entry.key, {
      name: `${I18N_ROOT}.Settings.${entry.key}.Name`,
      hint: `${I18N_ROOT}.Settings.${entry.key}.Hint`,
      scope: entry.scope,
      config: false,
      type: TYPES[entry.type],
      default: structuredClone(entry.key in defaults ? defaults[entry.key] : entry.default),
      onChange: reactions[entry.react],
    });
  }
  if (SettingsMenu) {
    game.settings.registerMenu(MODULE_ID, "configMenu", {
      name: `${I18N_ROOT}.Config.MenuName`,
      label: `${I18N_ROOT}.Config.MenuLabel`,
      hint: `${I18N_ROOT}.Config.MenuHint`,
      icon: "fa-solid fa-layer-group",
      type: SettingsMenu,
      restricted: false,
    });
  }
}

/** A setting's value, coerced to its type (a corrupted phase template reads as the default one). */
export function getSetting(key) {
  return coerceSetting(schemaEntry(key), game.settings.get(MODULE_ID, key));
}

/** The default a setting was registered with: the system's when it has one. */
export function registeredDefault(key) {
  return game.settings.settings?.get(`${MODULE_ID}.${key}`)?.default ?? schemaEntry(key)?.default;
}

export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/** The settings the phase window reads, gathered once per projection. */
export function projectionSettings() {
  return {
    showDcToPlayers: getSetting(SETTINGS.showDcToPlayers),
    autoAdvance: getSetting(SETTINGS.autoAdvance),
    dcSource: getSetting(SETTINGS.dcSource),
  };
}

/** Where the roll against the DC comes from, and the GM's formula (empty: the system's default). */
export function rollSettings() {
  return { source: getSetting(SETTINGS.rollSource), formula: getSetting(SETTINGS.rollFormula) };
}

/** Whether this player is asked to roll when a character of theirs joins without a roll. */
export function rollPrompt() {
  return getSetting(SETTINGS.rollPrompt);
}

/** Whether an enemy's items may suggest its phase when it enters. */
export function suggestFromSheet() {
  return getSetting(SETTINGS.suggestFromSheet);
}

/** The GM's rules for a natural 20 and 1 on the initiative d20. */
export function naturalRules() {
  return {
    natural20: getSetting(SETTINGS.natural20),
    natural1: getSetting(SETTINGS.natural1),
  };
}
