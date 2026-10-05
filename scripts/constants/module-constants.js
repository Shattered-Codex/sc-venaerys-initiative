export const MODULE_ID = "sc-venaerys-initiative";
export const I18N_ROOT = "SC_VENAERYS_INITIATIVE";
export const TEMPLATE_ROOT = `modules/${MODULE_ID}/templates`;

/** Every write the module makes carries this operation option: `{[OPERATION_KEY]: {reason}}`. */
export const OPERATION_KEY = MODULE_ID;
export const SOCKET_NAME = `module.${MODULE_ID}`;

/** The module's own hooks, called on every client after the combat update. */
export const HOOKS = Object.freeze({
  phaseChange: `${MODULE_ID}.phaseChange`,
  combatantDone: `${MODULE_ID}.combatantDone`,
});

/** Keybinding actions; none has a default key. `gm` ones are restricted to GMs. */
export const KEYBINDINGS = Object.freeze([
  { id: "markOwnDone", gm: false },
  { id: "advancePhase", gm: true },
  { id: "previousPhase", gm: true },
  { id: "showTracker", gm: false },
].map(Object.freeze));

/** Why the module wrote something; the closed list other code reads from the operation option. */
export const REASONS = Object.freeze({
  setup: "setup",
  toggle: "toggle",
  dc: "dc",
  placement: "placement",
  done: "done",
  start: "start",
  advance: "advance",
  round: "round",
  back: "back",
  anchor: "anchor",
  natural: "natural",
  marker: "marker",
  half: "half",
});

export const SETTINGS = Object.freeze({
  enabledByDefault: "enabledByDefault",
  phaseTemplate: "phaseTemplate",
  defaultDc: "defaultDc",
  showDcToPlayers: "showDcToPlayers",
  autoAdvance: "autoAdvance",
  openOnStart: "openOnStart",
  theme: "theme",
  dcSource: "dcSource",
  dcBase: "dcBase",
  natural20: "natural20",
  natural1: "natural1",
  suggestFromSheet: "suggestFromSheet",
  rollPrompt: "rollPrompt",
  rollSource: "rollSource",
  rollFormula: "rollFormula",
  splitPhases: "splitPhases",
  phaseTurnMarkers: "phaseTurnMarkers",
  hideEmptyPhases: "hideEmptyPhases",
  rollPromptImage: "rollPromptImage",
  bannerThemes: "bannerThemes",
  customAccent: "customAccent",
  customBackground: "customBackground",
  customText: "customText",
});

/** Combat flags. */
export const COMBAT_FLAGS = Object.freeze({
  enabled: "enabled",
  plan: "plan",
  dc: "dc",
  suspendedAdvance: "suspendedAdvance",
  split: "split",
  actionsHalf: "actionsHalf",
});

/** Actor flags: the phase a creature takes in every combat, unless the GM moves it. */
export const ACTOR_FLAGS = Object.freeze({
  defaultPhase: "defaultPhase",
});

/** Combatant flags. */
export const COMBATANT_FLAGS = Object.freeze({
  side: "side",
  phase: "phase",
  nextPhase: "nextPhase",
  pinned: "pinned",
  done: "done",
  moved: "moved",
  natural: "natural",
});

/** `event` is an event marker: a combatant with no actor that the GM adds to an event phase. */
export const SIDES = Object.freeze({ players: "players", enemies: "enemies", event: "event" });

export const PHASE_TYPES = Object.freeze({
  fast: "fast",
  enemies: "enemies",
  slow: "slow",
  creatures: "creatures",
  event: "event",
});

/** The built-in phases keep these ids; their relative order is fixed. */
export const BUILTIN_PHASE_IDS = Object.freeze({ fast: "fast", enemies: "enemies", slow: "slow" });
export const BUILTIN_ORDER = Object.freeze([BUILTIN_PHASE_IDS.fast, BUILTIN_PHASE_IDS.enemies, BUILTIN_PHASE_IDS.slow]);

/** Phase types of the players' side, the ones that roll against the DC. */
export const PLAYER_PHASE_TYPES = Object.freeze([PHASE_TYPES.fast, PHASE_TYPES.slow]);

/** The picture of a new event marker, a core icon. */
export const MARKER_IMG = "icons/svg/castle.svg";

/** Mirrors CONST.TOKEN_DISPOSITIONS so pure code does not need Foundry loaded. */
export const DISPOSITION = Object.freeze({ SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 });

/** Wide enough for d100 thresholds and high-level DCs; a difficulty level (1, 2, 3) fits too. */
export const DC_RANGE = Object.freeze({ min: 0, max: 100 });

/** Where a combat's DC comes from: typed by the GM, or a base plus the reference CR. */
export const DC_SOURCES = Object.freeze({ manual: "manual", baseCr: "baseCr" });

/**
 * What a critical or a fumble on the roll against the DC does: nothing, pass
 * or fail outright, or move the result one degree (a pass within 10 of the
 * DC, as a natural 20 or 1 does in Pathfinder 2e). The settings keep their
 * original names, `natural20` and `natural1`.
 */
export const NATURAL_RULES = Object.freeze({ none: "none", autoSuccess: "autoSuccess", autoFail: "autoFail", oneDegree: "oneDegree" });

/** A roll's extreme result, read by the system adapter (a natural 20 or 1, matching duality dice, a d100 01). */
export const CRITICALS = Object.freeze({ critical: "critical", fumble: "fumble" });

/** Which phases split into a movement half and an actions half; event phases never do. */
export const SPLIT_MODES = Object.freeze({ off: "off", players: "players", all: "all" });

/** The picture of a character in the roll prompt: its token's, or the sheet's portrait. */
export const PROMPT_IMAGES = Object.freeze({ token: "token", portrait: "portrait" });

/** What is heard when a phase starts: nothing (the default), the core's combat theme, or the GM's own file. */
export const SOUND_MODES = Object.freeze({ none: "none", theme: "theme", custom: "custom" });

/** The two halves of a split phase. */
export const HALVES = Object.freeze({ move: "move", act: "act" });

/** Where the roll against the DC comes from: the system's own initiative roll, or the GM's formula. */
export const ROLL_SOURCES = Object.freeze({ system: "system", formula: "formula" });

/** How long a phase advance may wait for its own write before the lock gives up. */
export const ADVANCE_LOCK_MS = 5000;
/** How often the busy probe looks at the active GM's open dialogs while an advance waits. */
export const BUSY_POLL_MS = 500;
/** Names listed in the start confirmation before "and N more". */
export const START_NAMES_SHOWN = 5;

/** Short icon list offered for extra phases. */
export const PHASE_ICONS = Object.freeze([
  "fa-solid fa-crown",
  "fa-solid fa-skull",
  "fa-solid fa-dragon",
  "fa-solid fa-khanda",
  "fa-solid fa-shield-halved",
  "fa-solid fa-bolt",
  "fa-solid fa-hourglass-half",
  "fa-solid fa-fire",
  "fa-solid fa-chess-rook",
  "fa-solid fa-eye",
  "fa-solid fa-ghost",
  "fa-solid fa-spider",
  "fa-solid fa-hand-fist",
  "fa-solid fa-wand-sparkles",
  "fa-solid fa-gem",
  "fa-solid fa-moon",
]);

/** The i18n key part that names an icon of the list: "fa-solid fa-crown" is "crown". */
export const iconName = (cls) => String(cls).split(" ").pop().replace(/^fa-/, "");

/** The names of the palette swatches, for screen readers and tooltips. */
export const PHASE_COLOR_NAMES = Object.freeze({
  "#c9503c": "red",
  "#d68a3a": "orange",
  "#c9b23c": "yellow",
  "#6fa35a": "green",
  "#3fa3a0": "teal",
  "#5b86c9": "blue",
  "#9184d9": "violet",
  "#b56fb0": "pink",
});

/** The design palette for extra phases, stored as #rrggbb. */
export const PHASE_COLORS = Object.freeze([
  "#c9503c",
  "#d68a3a",
  "#c9b23c",
  "#6fa35a",
  "#3fa3a0",
  "#5b86c9",
  "#9184d9",
  "#b56fb0",
]);
