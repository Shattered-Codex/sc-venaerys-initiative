import { defaultPlan } from "../../scripts/constants/default-phases.js";

/**
 * Builders for the flat combat snapshot the pure rules read. Combatants are
 * listed in turn order, as `combat.turns` would have them.
 */

let counter = 0;

export function combatant(overrides = {}) {
  counter += 1;
  return {
    id: overrides.id ?? `c${counter}`,
    name: overrides.name ?? overrides.id ?? `Combatant ${counter}`,
    img: null,
    side: "players",
    phase: null,
    nextPhase: null,
    pinned: false,
    done: null,
    moved: null,
    initiative: null,
    displayInitiative: 0,
    isDefeated: false,
    hidden: false,
    visible: true,
    isOwner: false,
    hasPlayerOwner: false,
    hasToken: true,
    disposition: -1,
    groupKey: null,
    ...overrides,
  };
}

export const player = (id, phase, overrides = {}) =>
  combatant({ id, side: "players", phase, initiative: phase ? 15 : null, hasPlayerOwner: true, disposition: 1, ...overrides });

export const enemy = (id, phase = "enemies", overrides = {}) =>
  combatant({ id, side: "enemies", phase, initiative: 12, displayInitiative: 12, ...overrides });

/** A started combat on round `round`, pointer on the combatant with id `on`. */
export function combatView({ combatants = [], round = 1, on = null, turn = null, plan = defaultPlan(), dc = 15, ...rest } = {}) {
  const pointer = on === null ? turn : combatants.findIndex((c) => c.id === on);
  return {
    id: "combat",
    enabled: true,
    started: round > 0,
    round,
    turn: pointer,
    plan,
    dc,
    suspendedAdvance: null,
    combatants,
    ...rest,
  };
}
