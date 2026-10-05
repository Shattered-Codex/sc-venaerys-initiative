import { MODULE_ID } from "./module-constants.js";

/**
 * The outbound links of the module, in the order the settings strip shows
 * them. This is the one file of the module that names remote addresses: they
 * are only ever opened in the browser by a click, never loaded.
 */
export const COMMUNITY_LINKS = Object.freeze([
  { id: "wiki", icon: "fa-solid fa-hat-wizard", url: `https://wiki.shattered-codex.com/modules/${MODULE_ID}` },
  { id: "patreon", icon: "fa-solid fa-heart", url: `https://www.patreon.com/c/shatteredcodex?utm_source=${MODULE_ID}&utm_medium=foundry_module&utm_campaign=support_settings` },
  { id: "discord", icon: "fa-brands fa-discord", url: "https://discord.gg/6mWCQEJEwG" },
].map(Object.freeze));
