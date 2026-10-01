import { COMBATANT_FLAGS, COMBAT_FLAGS, MODULE_ID, SIDES } from "../constants/module-constants.js";
import { schemaEntry } from "../constants/settings-schema.js";
import { validatePlan } from "../helpers/phase-plan.js";

const SIDE_VALUES = new Set(Object.values(SIDES));
const DEFAULT_DC = schemaEntry("defaultDc").default;

/**
 * The single reader of Combat and Combatant documents for the rules: it turns
 * a combat into the flat snapshot the helpers work on (see the typedefs in
 * helpers/phase-progression.js). Missing or broken flags never throw: a
 * combat with no valid plan reads as not phased, an unknown phase as pending.
 * Per-user fields (`visible`, `isOwner`) are the current user's.
 */
export default class CombatSnapshot {
  static #validPlans = new WeakMap();

  static flagsOf(document) {
    return document?.flags?.[MODULE_ID] ?? {};
  }

  /** The combat's plan when it runs in phases, else null. Cached per plan array. */
  static planOf(combat) {
    const flags = CombatSnapshot.flagsOf(combat);
    if (flags[COMBAT_FLAGS.enabled] !== true) return null;
    const plan = flags[COMBAT_FLAGS.plan];
    if (!plan || typeof plan !== "object") return null;
    let valid = CombatSnapshot.#validPlans.get(plan);
    if (valid === undefined) {
      valid = validatePlan(plan);
      CombatSnapshot.#validPlans.set(plan, valid);
    }
    return valid ? plan : null;
  }

  static isPhased(combat) {
    return CombatSnapshot.planOf(combat) !== null;
  }

  static dcOf(combat) {
    const value = CombatSnapshot.flagsOf(combat)[COMBAT_FLAGS.dc]?.value;
    return Number.isFinite(value) ? value : DEFAULT_DC;
  }

  /** @returns {import("../helpers/phase-progression.js").CombatView} */
  static from(combat, adapter) {
    const plan = CombatSnapshot.planOf(combat);
    const flags = CombatSnapshot.flagsOf(combat);
    const phaseIds = new Set((plan ?? []).map((phase) => phase.id));
    const suspended = flags[COMBAT_FLAGS.suspendedAdvance];
    return {
      id: combat.id,
      enabled: plan !== null,
      started: combat.round > 0,
      round: combat.round,
      turn: Number.isInteger(combat.turn) ? combat.turn : null,
      plan: plan ?? [],
      dc: CombatSnapshot.dcOf(combat),
      suspendedAdvance: typeof suspended === "string" ? suspended : null,
      combatants: (combat.turns ?? []).map((combatant) => CombatSnapshot.combatant(combatant, phaseIds, adapter)),
    };
  }

  /** @returns {import("../helpers/phase-progression.js").CombatantView} */
  static combatant(combatant, phaseIds, adapter) {
    const flags = CombatSnapshot.flagsOf(combatant);
    const known = (value) => (typeof value === "string" && phaseIds.has(value) ? value : null);
    const round = (value) => (Number.isInteger(value) ? value : null);
    const token = combatant.token;
    const side = flags[COMBATANT_FLAGS.side];
    return {
      id: combatant.id,
      name: combatant.name ?? "",
      img: combatant.img || null,
      side: SIDE_VALUES.has(side) ? side : null,
      phase: known(flags[COMBATANT_FLAGS.phase]),
      nextPhase: known(flags[COMBATANT_FLAGS.nextPhase]),
      pinned: flags[COMBATANT_FLAGS.pinned] === true,
      done: round(flags[COMBATANT_FLAGS.done]),
      moved: round(flags[COMBATANT_FLAGS.moved]),
      initiative: Number.isFinite(combatant.initiative) ? combatant.initiative : null,
      displayInitiative: adapter?.displayInitiative(combatant) ?? 0,
      isDefeated: !!combatant.isDefeated,
      hidden: !!combatant.hidden,
      visible: !!combatant.visible,
      isOwner: !!combatant.isOwner,
      hasPlayerOwner: !!combatant.hasPlayerOwner,
      hasToken: !!token,
      disposition: Number.isInteger(token?.disposition) ? token.disposition : null,
      groupKey: token?.baseActor?.id ?? combatant.actorId ?? null,
    };
  }
}
