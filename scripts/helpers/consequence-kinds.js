import { DEFAULT_BANNER_STYLE } from "./banner-themes.js";

/**
 * What a phase can do when it starts, with the consequence vocabulary of the
 * SC Combat Wheel (itself in the spirit of the SC Puzzle Engine). Each kind
 * says where it runs: "local" on every client that can see the phase
 * (message, sound, hook), "gm" once on the active GM (anything that writes or
 * talks to another module). `requires` names a module that must be active.
 *
 * Field types: text, textarea, number, select (with `choices`), macro, file,
 * uuid (accepts a dropped document), scare (a scare of the SC Jump Scare
 * library, by id), puzzle (a puzzle page of the SC Puzzle Engine, by UUID),
 * banner (a ready-made banner theme or one of the GM's own, by id).
 */
export const CONSEQUENCE_KINDS = Object.freeze({
  screenMessage: {
    where: "local",
    icon: "fa-solid fa-message",
    fields: [
      { name: "text", type: "textarea", default: "" },
      { name: "audience", type: "select", choices: ["all", "gm"], default: "all" },
      { name: "style", type: "banner", default: DEFAULT_BANNER_STYLE },
      { name: "seconds", type: "number", min: 2, max: 30, default: 6 },
    ],
  },
  sound: {
    where: "local",
    icon: "fa-solid fa-volume-high",
    fields: [
      { name: "src", type: "file", fileType: "audio", default: "" },
      { name: "volume", type: "number", min: 0, max: 100, default: 70 },
    ],
  },
  hook: {
    where: "local",
    icon: "fa-solid fa-code-branch",
    fields: [{ name: "name", type: "text", default: "" }],
  },
  chatMessage: {
    where: "gm",
    icon: "fa-solid fa-comment",
    fields: [
      { name: "text", type: "textarea", default: "" },
      { name: "audience", type: "select", choices: ["all", "gm"], default: "all" },
    ],
  },
  macro: {
    where: "gm",
    icon: "fa-solid fa-terminal",
    fields: [{ name: "macroUuid", type: "macro", default: "" }],
  },
  rollTable: {
    where: "gm",
    icon: "fa-solid fa-table-list",
    fields: [{ name: "tableUuid", type: "uuid", documentName: "RollTable", default: "" }],
  },
  jumpScare: {
    where: "gm",
    icon: "fa-solid fa-ghost",
    requires: "sc-jump-scare",
    fields: [{ name: "scareId", type: "scare", default: "" }],
  },
  puzzle: {
    where: "gm",
    icon: "fa-solid fa-puzzle-piece",
    requires: "sc-puzzle-engine",
    fields: [
      { name: "puzzleUuid", type: "puzzle", default: "" },
      { name: "action", type: "select", choices: ["open", "arm", "trigger"], default: "open" },
    ],
  },
  resource: {
    where: "gm",
    icon: "fa-solid fa-battery-half",
    requires: "sc-resources",
    fields: [
      { name: "target", type: "select", choices: ["members", "party", "combatants", "actor"], default: "members" },
      { name: "actorUuid", type: "uuid", documentName: "Actor", default: "" },
      { name: "resourceId", type: "text", default: "" },
      { name: "operation", type: "select", choices: ["add", "subtract", "set", "restore"], default: "add" },
      { name: "amount", type: "number", min: -9999, max: 9999, default: 1 },
    ],
  },
});

export const CONSEQUENCE_KIND_IDS = Object.freeze(Object.keys(CONSEQUENCE_KINDS));

/** A row with a known kind and every field typed and defaulted; null for an unknown kind. */
export function normalizeConsequence(raw = {}, makeId = () => Math.random().toString(36).slice(2, 12)) {
  const kind = CONSEQUENCE_KINDS[raw?.kind];
  if (!kind) return null;
  const params = {};
  for (const field of kind.fields) {
    const value = raw.params?.[field.name];
    if (field.type === "number") {
      const number = Number(value);
      params[field.name] = Number.isFinite(number) && value !== "" && value !== null
        ? Math.min(Math.max(number, field.min ?? -Infinity), field.max ?? Infinity)
        : field.default;
    } else if (field.type === "select") {
      params[field.name] = field.choices.includes(value) ? value : field.default;
    } else {
      params[field.name] = String(value ?? field.default).trim() || field.default;
    }
  }
  return { id: String(raw.id || makeId()), kind: raw.kind, enabled: raw.enabled !== false, params };
}

/** A phase's rows, normalized; unknown kinds are dropped. */
export function normalizeConsequences(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeConsequence(row)).filter(Boolean);
}

/**
 * Rows that run on this client: "gm" rows on the active GM only; "local" rows
 * where the phase is visible (a GM-only message on GM clients only). Rows of
 * a module that is not active never run.
 */
export function consequencesToRun(rows, { visible, isGM, isActiveGM, isModuleActive }) {
  return rows.filter((row) => {
    if (!row.enabled) return false;
    const kind = CONSEQUENCE_KINDS[row.kind];
    if (!kind || (kind.requires && !isModuleActive(kind.requires))) return false;
    if (kind.where === "gm") return isActiveGM;
    if (row.kind === "screenMessage" && row.params.audience === "gm") return visible && isGM;
    return visible;
  });
}
