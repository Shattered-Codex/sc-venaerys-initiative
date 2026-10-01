import { COMBAT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS, SETTINGS } from "../constants/module-constants.js";
import { currentPhaseId, isAdvanceSuspended, shouldAutoAdvance } from "../helpers/phase-progression.js";
import { getSetting } from "../hooks/register-settings.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";
import PhaseAdvancer from "./PhaseAdvancer.js";

const SUSPENDED_PATH = `flags.${MODULE_ID}.${COMBAT_FLAGS.suspendedAdvance}`;

/**
 * Watches done marks, defeat (by the tracker, the token HUD or any effect),
 * combatants entering and leaving, and turn changes the module did not make.
 * On the active GM only, and once per frame, it asks for the advance when the
 * current phase is complete, and re-anchors the pointer when someone else
 * moved it. When the active GM changes, the new one looks at every phased
 * combat: the pending request lived in the old one's memory.
 */
export default class AutoAdvanceWatcher {
  #dirty = new Map();
  #pointers = new Map();
  #activeGmId = null;

  constructor({ adapter, advancer, probe, requestFrame }) {
    this.adapter = adapter;
    this.advancer = advancer;
    this.probe = probe;
    this.scheduler = new FrameScheduler(ErrorGuard.wrap("auto-advance", () => this.flush()), { requestFrame });
  }

  static #isWatched(combat) {
    return !!combat && combat.started && CombatSnapshot.isPhased(combat);
  }

  /** Marks a combat for the next frame; `anchor` when the change did not come from the module. */
  mark(combat, { anchor = false, doneChanged = false } = {}) {
    if (!game.user.isActiveGM || !AutoAdvanceWatcher.#isWatched(combat)) return;
    const entry = this.#dirty.get(combat.id) ?? { anchor: false, doneChanged: false };
    entry.anchor ||= anchor;
    entry.doneChanged ||= doneChanged;
    this.#dirty.set(combat.id, entry);
    this.scheduler.schedule();
  }

  onUpdateCombatant(combatant, changes, options) {
    const combat = combatant.parent;
    // Only a mark in the current phase lifts a suspension there.
    const phaseOf = (c) => c?.flags?.[MODULE_ID]?.phase ?? null;
    const markedHere = "done" in (changes.flags?.[MODULE_ID] ?? {}) && phaseOf(combatant) === phaseOf(combat?.combatant);
    this.mark(combat, { anchor: !options?.[OPERATION_KEY], doneChanged: markedHere });
  }

  onCreateCombatant(combatant, options) {
    this.mark(combatant.parent, { anchor: !options?.[OPERATION_KEY] });
  }

  onDeleteCombatant(combatant, options) {
    this.mark(combatant.parent, { anchor: !options?.[OPERATION_KEY] });
  }

  onUpdateCombat(combat, changed, options) {
    const own = options?.[OPERATION_KEY];
    if (own) this.advancer.release(combat.id);
    const moved = "turn" in changed || "round" in changed;
    this.mark(combat, { anchor: !own && moved });
  }

  /** Defeat often arrives as a status effect, with no Combatant update: every watched combat is re-read. */
  onActiveEffect(effect, changes = null) {
    const defeated = CONFIG.specialStatusEffects?.DEFEATED;
    const relevant = effect?.statuses?.has?.(defeated) || (changes && ("statuses" in changes || "disabled" in changes));
    if (!relevant) return;
    for (const combat of game.combats ?? []) this.mark(combat);
  }

  /** The new active GM takes over every phased combat in progress. */
  onUserConnected() {
    const activeId = game.users.activeGM?.id ?? null;
    const changed = activeId !== this.#activeGmId;
    this.#activeGmId = activeId;
    if (changed && game.user.isActiveGM) this.reviewAll();
  }

  reviewAll() {
    this.#activeGmId = game.users.activeGM?.id ?? null;
    for (const combat of game.combats ?? []) this.mark(combat);
  }

  async flush() {
    const dirty = [...this.#dirty];
    this.#dirty.clear();
    if (!game.user.isActiveGM) return;
    for (const [combatId, { anchor, doneChanged }] of dirty) {
      const combat = game.combats.get(combatId);
      if (AutoAdvanceWatcher.#isWatched(combat)) await this.#review(combat, { anchor, doneChanged });
    }
  }

  async #review(combat, { anchor, doneChanged }) {
    const view = CombatSnapshot.from(combat, this.adapter);
    const pointer = view.turn === null ? null : view.combatants[view.turn];
    const current = currentPhaseId(view);
    const known = this.#pointers.get(combat.id);
    // With nothing known yet (after a reload) the pointer is taken as it is.
    const movedByOthers = anchor && !!known && known.id !== pointer?.id;
    if (current === null || movedByOthers) {
      if (await this.advancer.anchor(combat, known?.phaseId ?? null)) return;
    }
    if (current !== null) this.#pointers.set(combat.id, { id: pointer.id, phaseId: current });

    const suspended = isAdvanceSuspended(view);
    if (suspended && doneChanged) {
      // The next mark in a suspended phase lifts the suspension.
      const complete = shouldAutoAdvance({ ...view, suspendedAdvance: null });
      if (!complete || !getSetting(SETTINGS.autoAdvance)) {
        await combat.update({ [SUSPENDED_PATH]: null }, { [OPERATION_KEY]: { reason: REASONS.done } });
        return;
      }
    } else if (!shouldAutoAdvance(view)) {
      this.probe.cancel(combat.id);
      return;
    }
    if (!getSetting(SETTINGS.autoAdvance)) return;
    const key = PhaseAdvancer.keyOf(view);
    this.probe.request(combat.id, () => this.#fire(combat.id, key));
  }

  #fire(combatId, key) {
    const combat = game.combats.get(combatId);
    if (!game.user.isActiveGM || !AutoAdvanceWatcher.#isWatched(combat)) return undefined;
    return ErrorGuard.wrap("auto-advance", () => this.advancer.advance(combat, { expectedKey: key }))();
  }
}
