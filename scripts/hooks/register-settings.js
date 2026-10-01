import { I18N_ROOT, MODULE_ID, SETTINGS } from "../constants/module-constants.js";
import { SETTINGS_SCHEMA, coerceSetting, schemaEntry } from "../constants/settings-schema.js";

const TYPES = { boolean: Boolean, number: Number, array: Array };

/**
 * Registers every setting of SETTINGS_SCHEMA. None shows in the core menu:
 * they live in the module's own configuration screen, opened by
 * `SettingsMenu`. `onViewChange` re-projects the phase window.
 */
export function registerSettings({ onViewChange, SettingsMenu }) {
  const reactions = { view: onViewChange };
  for (const entry of SETTINGS_SCHEMA) {
    game.settings.register(MODULE_ID, entry.key, {
      name: `${I18N_ROOT}.Settings.${entry.key}.Name`,
      hint: `${I18N_ROOT}.Settings.${entry.key}.Hint`,
      scope: entry.scope,
      config: false,
      type: TYPES[entry.type],
      default: structuredClone(entry.default),
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

export function setSetting(key, value) {
  return game.settings.set(MODULE_ID, key, value);
}

/** The settings the phase window reads, gathered once per projection. */
export function projectionSettings() {
  return {
    showDcToPlayers: getSetting(SETTINGS.showDcToPlayers),
    autoAdvance: getSetting(SETTINGS.autoAdvance),
  };
}
