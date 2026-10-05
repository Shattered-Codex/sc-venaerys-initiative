import { BUILTIN_ORDER, PHASE_TYPES, PLAYER_PHASE_TYPES, SIDES } from "../constants/module-constants.js";
import { NEW_EVENT_PHASE, NEW_PHASE, defaultPlan } from "../constants/default-phases.js";

/**
 * Pure rules of a phase plan: the ordered list of phases a combat runs
 * through each round. A plan is valid when ids are unique, each built-in
 * phase appears exactly once under its own id, Fast comes before Enemies
 * before Slow, and every phase has a name or a name key.
 */

const KNOWN_TYPES = new Set(Object.values(PHASE_TYPES));
const COLOR = /^#[0-9a-f]{6}$/i;

export function isBuiltin(phase) {
  return BUILTIN_ORDER.includes(phase?.type);
}

/** An event phase: only event markers act in it. */
export function isEventPhase(phase) {
  return phase?.type === PHASE_TYPES.event;
}

/** Event markers go to event phases only, and everyone else to any other phase. */
export function canEnterPhase(combatant, phase) {
  return !!phase && (combatant?.side === SIDES.event) === isEventPhase(phase);
}

/** The name a client shows: the GM's own text, else the translated default. */
export function displayName(phase, localize) {
  if (typeof phase?.name === "string" && phase.name.trim()) return phase.name;
  return phase?.nameKey ? localize(phase.nameKey) : "";
}

function hasName(phase) {
  return (typeof phase.name === "string" && phase.name.trim() !== "") || (typeof phase.nameKey === "string" && phase.nameKey !== "");
}

function isValidPhase(phase) {
  if (!phase || typeof phase !== "object") return false;
  if (typeof phase.id !== "string" || !phase.id) return false;
  if (!KNOWN_TYPES.has(phase.type)) return false;
  if (isBuiltin(phase) && phase.id !== phase.type) return false;
  if (phase.name !== null && phase.name !== undefined && typeof phase.name !== "string") return false;
  if (phase.nameKey !== null && phase.nameKey !== undefined && typeof phase.nameKey !== "string") return false;
  if (typeof phase.icon !== "string" || !phase.icon) return false;
  if (typeof phase.color !== "string" || !COLOR.test(phase.color)) return false;
  return hasName(phase);
}

/** Fast before Enemies before Slow, whatever sits around them. */
export function isValidPlanOrder(plan) {
  const positions = BUILTIN_ORDER.map((id) => plan.findIndex((phase) => phase.id === id));
  return positions.every((position, i) => position >= 0 && (i === 0 || position > positions[i - 1]));
}

export function validatePlan(plan) {
  if (!Array.isArray(plan) || !plan.every(isValidPhase)) return false;
  const ids = plan.map((phase) => phase.id);
  if (new Set(ids).size !== ids.length) return false;
  for (const type of BUILTIN_ORDER) {
    if (plan.filter((phase) => phase.type === type).length !== 1) return false;
  }
  return isValidPlanOrder(plan);
}

/** A valid, independent copy of `plan`, or the default template when it is not valid. Unknown fields survive. */
export function normalizePlan(plan) {
  return validatePlan(plan) ? plan.map((phase) => structuredClone(phase)) : defaultPlan();
}

export function phaseById(plan, id) {
  return plan.find((phase) => phase.id === id) ?? null;
}

/** Position of a phase in the round; no phase (pending) or an unknown one sorts after every phase. */
export function phaseRank(plan, phaseId) {
  const index = phaseId == null ? -1 : plan.findIndex((phase) => phase.id === phaseId);
  return index === -1 ? plan.length : index;
}

/** Position of the first phase of the players' side: where the round-1 roll lock stops. */
export function firstPlayerPhaseRank(plan) {
  const index = plan.findIndex((phase) => PLAYER_PHASE_TYPES.includes(phase.type));
  return index === -1 ? plan.length : index;
}

/** Moves `draggedId` to just before `beforeId` (or to the end when `beforeId` is null). */
export function reorderIds(ids, draggedId, beforeId) {
  if (!ids.includes(draggedId) || draggedId === beforeId) return [...ids];
  const rest = ids.filter((id) => id !== draggedId);
  const at = beforeId == null ? rest.length : rest.indexOf(beforeId);
  if (at === -1) return [...ids];
  rest.splice(at, 0, draggedId);
  return rest;
}

/** The plan in the order of `ids`, or null when that order would invert the built-in phases. */
export function reorderPlan(plan, ids) {
  const next = ids.map((id) => phaseById(plan, id)).filter(Boolean);
  if (next.length !== plan.length) return null;
  return isValidPlanOrder(next) ? next : null;
}

/** Moves a phase one step up (-1) or down (+1); null at the edges or when the order would break. */
export function movePhase(plan, id, offset) {
  const from = plan.findIndex((phase) => phase.id === id);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= plan.length) return null;
  const next = [...plan];
  [next[from], next[to]] = [next[to], next[from]];
  return isValidPlanOrder(next) ? next : null;
}

/** Appends a new creatures phase, or an event phase. `makeId` must return an id not used in the plan. */
export function addPhase(plan, makeId, { event = false } = {}) {
  return [...plan, { id: makeId(), ...structuredClone(event ? NEW_EVENT_PHASE : NEW_PHASE) }];
}

/** Renames an extra phase; null for built-ins and empty names. */
export function renamePhase(plan, id, name) {
  const phase = phaseById(plan, id);
  const text = String(name ?? "").trim();
  if (!phase || isBuiltin(phase) || !text) return null;
  return plan.map((p) => (p.id === id ? { ...p, name: text } : p));
}

/** Changes the icon and/or color of an extra phase; null for built-ins. */
export function restylePhase(plan, id, { icon, color } = {}) {
  const phase = phaseById(plan, id);
  if (!phase || isBuiltin(phase)) return null;
  if (color !== undefined && !COLOR.test(color)) return null;
  return plan.map((p) => (p.id === id ? { ...p, ...(icon ? { icon } : {}), ...(color ? { color } : {}) } : p));
}

/** Removes an extra phase; null for built-ins. */
export function deletePhase(plan, id) {
  const phase = phaseById(plan, id);
  if (!phase || isBuiltin(phase)) return null;
  return plan.filter((p) => p.id !== id);
}

/** Ids of phases a save must refuse: a name the GM cleared, or no name at all. */
export function phasesWithoutName(plan) {
  const cleared = (phase) => typeof phase.name === "string" && phase.name.trim() === "";
  return plan.filter((phase) => cleared(phase) || !hasName(phase)).map((phase) => phase.id);
}
