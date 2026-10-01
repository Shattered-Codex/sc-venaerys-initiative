import { ADVANCE_LOCK_MS, COMBATANT_FLAGS, COMBAT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import { rolloverPlan } from "../helpers/phase-placement.js";
import {
  advanceTarget,
  anchorTarget,
  backTarget,
  currentPhaseId,
  pendingToSlow,
  roundStartTarget,
  startNeedsConfirmation,
  suspensionKey,
} from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";
import PhasePlacementWriter from "./PhasePlacementWriter.js";

const SUSPENDED_PATH = `flags.${MODULE_ID}.${COMBAT_FLAGS.suspendedAdvance}`;

/**
 * Moves the pointer between phases: advance, round change, back, re-anchor
 * and the second write of the start. Runs on the active GM only. Every move
 * is one native Combat update that mirrors the core's own navigation: the
 * `combatTurn`/`combatRound` hook first, then `update` with `direction` and
 * the world-time delta the core would have applied, so turn events, system
 * recoveries and listeners of those hooks keep working.
 */
export default class PhaseAdvancer {
  #locks = new Map();

  constructor({ adapter, writer }) {
    this.adapter = adapter;
    this.writer = writer;
  }

  snapshot(combat) {
    return CombatSnapshot.from(combat, this.adapter);
  }

  /** The key of the phase the combat is in: an advance from it happens once. */
  static keyOf(view) {
    return suspensionKey(view.round, currentPhaseId(view) ?? `turn-${view.turn}`);
  }

  #lock(combatId, key) {
    clearTimeout(this.#locks.get(combatId)?.timer);
    // Released by the write itself; the timer only covers a write that never comes back.
    const timer = setTimeout(() => this.release(combatId, key), ADVANCE_LOCK_MS);
    this.#locks.set(combatId, { key, timer });
  }

  release(combatId, key = null) {
    const lock = this.#locks.get(combatId);
    if (!lock || (key !== null && lock.key !== key)) return;
    clearTimeout(lock.timer);
    this.#locks.delete(combatId);
  }

  isLocked(combatId, key) {
    return this.#locks.get(combatId)?.key === key;
  }

  /**
   * Advances to the next phase with someone to block, or turns the round.
   * `force` (the GM's command) goes past the round-1 roll lock by placing
   * whoever is still pending in Slow. `expectedKey` (an automatic request)
   * drops the request if the combat already moved on.
   */
  async advance(combat, { force = false, expectedKey = null } = {}) {
    let view = this.snapshot(combat);
    if (!view.enabled || !view.started) return false;
    const key = PhaseAdvancer.keyOf(view);
    if ((expectedKey !== null && expectedKey !== key) || this.isLocked(combat.id, key)) return false;
    if (currentPhaseId(view) === null) return this.anchor(combat);
    this.#lock(combat.id, key);
    try {
      let target = advanceTarget(view);
      if (target.waitRolls && force) {
        await this.writer.apply(combat, pendingToSlow(view));
        view = this.snapshot(combat);
        target = advanceTarget(view);
      }
      if (target.waitRolls || target.none) return false;
      if ("round" in target) await this.#turnRound(combat, view);
      else await this.#move(combat, view, { round: view.round, turn: target.turn }, { direction: 1, reason: REASONS.advance });
      return true;
    } finally {
      this.release(combat.id, key);
    }
  }

  /** Goes back one phase, or into the previous round; refused in round 1 with nothing earlier. */
  async back(combat) {
    const view = this.snapshot(combat);
    if (!view.enabled || !view.started) return false;
    const target = backTarget(view);
    if (target.refuse || target.none) return false;
    const flags = { [SUSPENDED_PATH]: target.suspend };
    if (!("round" in target)) {
      await this.#move(combat, view, { round: view.round, turn: target.turn }, { direction: -1, reason: REASONS.back, flags });
      return true;
    }
    if (target.clear.length) {
      const updates = target.clear.map(({ id, ...data }) => {
        const update = { _id: id };
        for (const [field, value] of Object.entries(data)) update[`flags.${MODULE_ID}.${field}`] = value;
        return update;
      });
      await combat.updateEmbeddedDocuments("Combatant", updates, { [OPERATION_KEY]: { reason: REASONS.done } });
    }
    await this.#move(combat, view, { round: target.round, turn: target.turn }, { direction: -1, reason: REASONS.back, flags, hook: "combatRound" });
    return true;
  }

  /** Brings the pointer back to the resting member of its phase after a change the module did not make. */
  async anchor(combat, lastKnownPhaseId = null) {
    const view = this.snapshot(combat);
    if (!view.enabled) return false;
    const target = anchorTarget(view, lastKnownPhaseId);
    if (!target || target.none) return false;
    const direction = view.turn !== null && target.turn < view.turn ? -1 : 1;
    await this.#move(combat, view, { round: view.round, turn: target.turn }, { direction, reason: REASONS.anchor });
    return true;
  }

  /**
   * After the native start (round 0 to 1): whoever is still pending goes to
   * Slow when the start lands at Fast's position or later, then the pointer
   * moves to the last blocking member of the first phase. The native start
   * keeps turn 0, which integrations that only handle `turn 0` expect.
   */
  async afterNativeStart(combat) {
    let view = this.snapshot(combat);
    if (!view.enabled || view.round !== 1) return false;
    if (startNeedsConfirmation(view)) {
      await this.writer.apply(combat, pendingToSlow(view));
      view = this.snapshot(combat);
    }
    const target = roundStartTarget(view, 1);
    if (!target || target.turn === view.turn) return false;
    await this.#move(combat, view, { round: 1, turn: target.turn }, { direction: 1, reason: REASONS.start });
    return true;
  }

  async #turnRound(combat, view) {
    const rollover = rolloverPlan(view);
    if (rollover.updates.length) {
      const extra = rollover.combatTurn === null ? {} : { combatTurn: rollover.combatTurn, turnEvents: false };
      await combat.updateEmbeddedDocuments("Combatant", rollover.updates.map(PhasePlacementWriter.toUpdate), PhasePlacementWriter.options(extra));
      view = this.snapshot(combat);
    }
    // Last round's done marks stop counting by themselves: done holds a round number.
    const target = roundStartTarget(view, view.round + 1);
    if (!target) return;
    await this.#move(combat, view, { round: view.round + 1, turn: target.turn }, { direction: 1, reason: REASONS.round, hook: "combatRound" });
  }

  async #move(combat, view, { round, turn }, { direction, reason, flags = {}, hook = "combatTurn" }) {
    const updateData = { round, turn };
    const updateOptions = {
      direction,
      worldTime: { delta: combat.getTimeDelta(combat.round, combat.turn, round, turn) },
      [OPERATION_KEY]: { reason },
    };
    Hooks.callAll(hook, combat, updateData, updateOptions);
    const suspension = view.suspendedAdvance !== null && !(SUSPENDED_PATH in flags) ? { [SUSPENDED_PATH]: null } : {};
    await combat.update({ ...updateData, ...suspension, ...flags }, updateOptions);
  }

  /** The done marks a phase completion writes: every member of the current phase not yet done. */
  static completionUpdates(view) {
    const current = currentPhaseId(view);
    return view.combatants
      .filter((c) => c.phase === current && c.done !== view.round)
      .map((c) => ({ _id: c.id, [`flags.${MODULE_ID}.${COMBATANT_FLAGS.done}`]: view.round }));
  }

  /** "Complete phase": everyone in the current phase is done and the combat advances now, busy GM or not. */
  async complete(combat) {
    const view = this.snapshot(combat);
    if (!view.enabled || currentPhaseId(view) === null) return false;
    const updates = PhaseAdvancer.completionUpdates(view);
    if (updates.length) await combat.updateEmbeddedDocuments("Combatant", updates, { [OPERATION_KEY]: { reason: REASONS.done } });
    return this.advance(combat);
  }
}
