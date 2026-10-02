import { COMBATANT_FLAGS, COMBAT_FLAGS, CRITICALS, DC_SOURCES, MODULE_ID, SIDES, SPLIT_MODES } from "../constants/module-constants.js";
import { schemaEntry } from "../constants/settings-schema.js";
import { validatePlan } from "../helpers/phase-plan.js";

const SIDE_VALUES = new Set(Object.values(SIDES));
const SPLIT_VALUES = new Set(Object.values(SPLIT_MODES));
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

  /** How the DC was set: by hand, or base plus reference CR (frozen at the start). */
  static dcRuleOf(combat) {
    const dc = CombatSnapshot.flagsOf(combat)[COMBAT_FLAGS.dc] ?? {};
    const number = (value) => (Number.isFinite(value) ? value : null);
    if (dc.source !== DC_SOURCES.baseCr) return { source: DC_SOURCES.manual, base: null, referenceCr: null };
    return { source: DC_SOURCES.baseCr, base: number(dc.base), referenceCr: number(dc.referenceCr) };
  }

  /**
   * The critical or fumble recorded for the combatant's current initiative; a
   * later initiative makes it stale. Marks written as a natural 20 or 1 read
   * as a critical or a fumble.
   */
  static naturalOf(combatant) {
    const natural = CombatSnapshot.flagsOf(combatant)[COMBATANT_FLAGS.natural];
    if (!natural || natural.initiative !== combatant.initiative) return null;
    if (natural.value === CRITICALS.critical || natural.value === 20) return CRITICALS.critical;
    if (natural.value === CRITICALS.fumble || natural.value === 1) return CRITICALS.fumble;
    return null;
  }

  /** An event marker: a combatant with no actor that the GM added to an event phase. */
  static isEventMarker(combatant) {
    return CombatSnapshot.flagsOf(combatant)[COMBATANT_FLAGS.side] === SIDES.event;
  }

  /** The phase of the combatant the combat pointed at before its last update. */
  static previousPhaseOf(combat) {
    const previousId = combat.previous?.combatantId;
    const previous = previousId ? combat.combatants.get(previousId) : null;
    return CombatSnapshot.flagsOf(previous)[COMBATANT_FLAGS.phase] ?? null;
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
      dcRule: CombatSnapshot.dcRuleOf(combat),
      suspendedAdvance: typeof suspended === "string" ? suspended : null,
      split: SPLIT_VALUES.has(flags[COMBAT_FLAGS.split]) ? flags[COMBAT_FLAGS.split] : SPLIT_MODES.off,
      actionsHalf: typeof flags[COMBAT_FLAGS.actionsHalf] === "string" ? flags[COMBAT_FLAGS.actionsHalf] : null,
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
      natural: CombatSnapshot.naturalOf(combatant),
      cr: adapter?.challengeRating?.(combatant.actor) ?? null,
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
