import { BUILTIN_PHASE_IDS, DC_SOURCES, I18N_ROOT, SIDES } from "../constants/module-constants.js";
import { canEnterPhase, displayName, isEventPhase, phaseById } from "../helpers/phase-plan.js";
import {
  advanceTarget,
  canToggleDone,
  currentPhaseId,
  firstBlockingPhase,
  hasNoRoll,
  isPhaseComplete,
  pendingOf,
} from "../helpers/phase-progression.js";
import { visibleCombat } from "../helpers/phase-visibility.js";

const T = (key) => `${I18N_ROOT}.${key}`;

/**
 * Turns a combat snapshot into what one user's phase window shows: plain
 * data, already filtered by what that user may see, with every label
 * localized. Players never receive a hidden combatant, the name of a phase
 * with nobody visible in it, or the DC unless the GM shares it.
 */
export default class CombatPhaseProjector {
  /**
   * @param {object} view                         CombatSnapshot.from(combat)
   * @param {{isGM: boolean}} user
   * @param {{showDcToPlayers: boolean, autoAdvance: boolean, dcSource?: string}} settings
   * @param {object} [options]
   * @param {(key: string) => string} options.localize
   * @param {(key: string, data: object) => string} options.format
   * @param {number} [options.decimals]            CONFIG.Combat.initiative.decimals
   * @param {boolean} [options.waitingForDialog]   the active GM's advance waits on a dialog
   * @param {Set<string>} [options.expanded]       open groups and finished phases of this window
   * @param {(dc: number) => string|null} [options.dcName]  the DC's name where the system reads it as a level
   * @param {string|null} [options.rollProblem]     why the system's roll cannot work with the DC (GM only)
   */
  static project(view, user, settings, { localize, format, decimals = 2, waitingForDialog = false, expanded = new Set(), dcName = () => null, rollProblem = null }) {
    const isGM = !!user.isGM;
    const visible = visibleCombat(view, { isGM, showDcToPlayers: settings.showDcToPlayers });
    const phaseName = (id) => displayName(phaseById(view.plan, id), localize);
    const current = currentPhaseId(view);
    const currentName = current ? phaseName(current) : "";
    const shown = [...visible.phases.flatMap((p) => p.members ?? []), ...visible.pending];
    const places = shown.some((c) => Number.isFinite(c.initiative) && !Number.isInteger(c.initiative)) ? decimals : 0;
    const pointerId = isGM && current ? view.combatants[view.turn]?.id ?? null : null;
    const ctx = { view, isGM, localize, format, places, phaseName, expanded, pointerId };

    const phases = visible.phases.map((entry) => {
      if (entry.waitingForGm) return { key: "waiting", waitingForGm: true, label: localize(T("Tracker.WaitingForGm")) };
      return CombatPhaseProjector.#phase(entry, ctx);
    });
    const pending = visible.pending.map((c) => ({
      id: c.id,
      name: c.name,
      img: c.img,
      mine: c.isOwner && !isGM,
      // Whoever may roll it: its owner, or a GM rolling for an absent player.
      roll: isGM || c.isOwner ? { label: format(T("Tracker.RollFor"), { name: c.name }) } : null,
    }));

    return {
      enabled: view.enabled,
      isGM,
      started: view.started,
      round: view.round,
      roundLabel: format(T("Tracker.Round"), { round: view.round }),
      stateLabel: localize(T(view.started ? "Tracker.InCombat" : "Tracker.NotStarted")),
      stateIcon: view.started ? "fa-solid fa-swords" : "fa-solid fa-pause",
      dc: visible.showDc ? { value: view.dc, text: CombatPhaseProjector.#dcText(view.dc, { format, dcName }) } : null,
      gm: isGM ? CombatPhaseProjector.#gmPanel(view, settings, { ...ctx, current, currentName, waitingForDialog, rollProblem }) : null,
      phases,
      pending,
      hasPending: pending.length > 0,
      youPending: pending.some((p) => p.mine),
    };
  }

  static #phase(entry, ctx) {
    const { view, isGM, localize, format, phaseName, expanded } = ctx;
    const { phase, state, members } = entry;
    const name = phaseName(phase.id);
    const alive = members.filter((c) => !c.isDefeated);
    const done = alive.filter((c) => c.done === view.round).length;
    const total = alive.length;
    const isPast = state === "past";
    const showCount = view.started && state !== "future" && members.length > 0;
    const pastKey = `past:${phase.id}`;
    const rows = CombatPhaseProjector.#rows(members, { ...ctx, phase, name, state });
    return {
      key: phase.id,
      id: phase.id,
      waitingForGm: false,
      name,
      icon: phase.icon,
      color: phase.color,
      state,
      isCurrent: state === "current",
      isPast,
      isEmpty: members.length === 0,
      count: showCount ? format(T("Tracker.DoneCount"), { done: isPast ? total : done, total }) : null,
      complete: state === "current" && isPhaseComplete(view, phase.id),
      compact: isPast && !(isGM && expanded.has(pastKey)) ? members.map((c) => c.name).join(", ") : null,
      pastToggle: isPast && isGM && members.length > 0 ? { key: pastKey, expanded: expanded.has(pastKey), label: format(T(expanded.has(pastKey) ? "Tracker.Collapse" : "Tracker.Expand"), { name }) } : null,
      rows,
      nowLabel: localize(T("Tracker.Now")),
      pastLabel: localize(T("Tracker.Past")),
      emptyLabel: localize(T("Tracker.NoCombatants")),
      gmOnlyLabel: localize(T("Tracker.GmOnly")),
      // An event phase only happens in combats where the GM adds a marker to it.
      addMarker: isGM && isEventPhase(phase) ? { label: format(T("Tracker.AddMarkerLabel"), { phase: name }) } : null,
    };
  }

  /** Rows of one phase; identical enemies come together as an expandable group. */
  static #rows(members, ctx) {
    const { expanded, phase } = ctx;
    const rows = [];
    const groups = new Map();
    for (const combatant of members) {
      const key = combatant.side === SIDES.enemies && combatant.groupKey ? combatant.groupKey : null;
      const twins = key ? members.filter((c) => c.side === SIDES.enemies && c.groupKey === key) : [];
      if (twins.length < 2) {
        rows.push(CombatPhaseProjector.#row(combatant, ctx));
        continue;
      }
      if (groups.has(key)) continue;
      const groupKey = `group:${phase.id}:${key}`;
      const children = twins.map((c) => CombatPhaseProjector.#row(c, ctx));
      const alive = twins.filter((c) => !c.isDefeated);
      const isOpen = expanded.has(groupKey);
      const group = {
        isGroup: true,
        key: groupKey,
        name: `${twins[0].name} ×${twins.length}`,
        img: twins[0].img,
        expanded: isOpen,
        toggleLabel: ctx.format(T(isOpen ? "Tracker.Collapse" : "Tracker.Expand"), { name: twins[0].name }),
        count: `${alive.filter((c) => c.done === ctx.view.round).length}/${alive.length}`,
        completeButton: ctx.isGM && ctx.state === "current" && alive.some((c) => c.done !== ctx.view.round)
          ? { label: ctx.format(T("Tracker.CompleteGroupLabel"), { name: twins[0].name, phase: ctx.name }) }
          : null,
        children,
      };
      groups.set(key, group);
      rows.push(group);
    }
    return rows;
  }

  static #row(c, ctx) {
    const { view, isGM, localize, format, places, phaseName, name: phase, state, pointerId } = ctx;
    const done = c.done === view.round;
    const canToggle = canToggleDone(view, c, { isGM });
    const current = state === "current";
    const marker = c.side === SIDES.event;
    const rollsNot = c.side === SIDES.enemies || marker;
    const doneLabel = format(T(done ? "Tracker.UnmarkDoneLabel" : "Tracker.MarkDoneLabel"), { name: c.name, phase });
    const row = {
      isGroup: false,
      id: c.id,
      name: c.name,
      img: c.img,
      initiative: rollsNot ? "—" : CombatPhaseProjector.formatInitiative(c.initiative, places),
      initiativeLabel: rollsNot ? localize(T("Tracker.NoInitiative")) : null,
      marker,
      done,
      defeated: c.isDefeated,
      hidden: isGM && c.hidden,
      // A marker is always pinned to its event phase: nothing to point out.
      pinned: isGM && c.pinned && !marker,
      // The core's end of turn reaches this member alone, when the phase ends.
      pointer: c.id === pointerId ? { label: format(T("Tracker.PointerLabel"), { name: c.name }) } : null,
      deferred: isGM && c.nextPhase ? format(T("Tracker.NextRound"), { phase: phaseName(c.nextPhase) }) : null,
      noRoll: isGM && hasNoRoll(c),
      skipped: state === "future" && done,
      // Done controls: a toggle for whoever may mark this row in the current phase (or a GM in a finished one).
      doneButton: canToggle && !c.isDefeated && (current || (isGM && state === "past")) ? { pressed: done, label: doneLabel, big: !isGM && c.isOwner } : null,
      doneStatus: current && !canToggle && !c.isDefeated,
      skipButton: isGM && view.started && state === "future" && !c.isDefeated ? { pressed: done, label: format(T(done ? "Tracker.UnskipLabel" : "Tracker.SkipLabel"), { name: c.name }) } : null,
      rollButton: c.side === SIDES.players && !Number.isFinite(c.initiative) && (isGM || c.isOwner)
        ? { label: format(T("Tracker.RollFor"), { name: c.name }) }
        : null,
      select: isGM ? CombatPhaseProjector.#select(c, ctx) : null,
    };
    return row;
  }

  /** The phases a combatant may be moved to; a marker has no "Automatic", it only changes event phase. */
  static #select(c, { view, localize, format, phaseName }) {
    const marker = c.side === SIDES.event;
    const chosen = c.pinned ? c.nextPhase ?? c.phase : "auto";
    const phases = view.plan.filter((p) => canEnterPhase(c, p));
    return {
      label: format(T("Tracker.PhaseSelectLabel"), { name: c.name }),
      options: [
        ...(marker ? [] : [{ value: "auto", label: localize(T("Tracker.Automatic")), selected: chosen === "auto" }]),
        ...phases.map((p) => ({ value: p.id, label: phaseName(p.id), selected: chosen === p.id })),
      ],
    };
  }

  static #dcText(dc, { format, dcName }) {
    const name = dcName(dc);
    return name ? format(T("Tracker.DcNamed"), { dc, name }) : format(T("Tracker.Dc"), { dc });
  }

  static #gmPanel(view, settings, { localize, format, current, currentName, waitingForDialog, phaseName, rollProblem }) {
    const warnings = [];
    if (rollProblem) warnings.push({ icon: "fa-solid fa-dice-d20", text: localize(T("Roll.ProblemTitle")), hint: rollProblem, action: null });
    const pending = pendingOf(view).length;
    const target = view.started ? advanceTarget(view) : null;
    if (target?.waitRolls) {
      warnings.push({
        icon: "fa-solid fa-hourglass-half",
        text: pending === 1 ? localize(T("Gm.AwaitingRollsOne")) : format(T("Gm.AwaitingRollsMany"), { count: pending }),
        hint: format(T("Gm.AdvanceAnywayHint"), { slow: phaseName(BUILTIN_PHASE_IDS.slow), fast: phaseName(BUILTIN_PHASE_IDS.fast) }),
        action: { name: "advance", label: localize(T("Gm.AdvanceAnyway")) },
        roll: { label: localize(T("Gm.RollForThem")) },
      });
    }
    if (waitingForDialog) warnings.push({ icon: "fa-solid fa-comment-dots", text: localize(T("Gm.DialogWait")), hint: localize(T("Gm.DialogWaitHint")), action: null });
    const complete = current !== null && isPhaseComplete(view, current);
    if (complete && !settings.autoAdvance && !target?.waitRolls) {
      warnings.push({ icon: "fa-solid fa-flag-checkered", text: localize(T("Gm.PhaseComplete")), hint: localize(T("Gm.PhaseCompleteHint")), action: null });
    }
    const rule = view.dcRule ?? { source: DC_SOURCES.manual };
    const baseCr = rule.source === DC_SOURCES.baseCr;
    if (baseCr && !view.started && !rule.referenceCr) {
      warnings.push({ icon: "fa-solid fa-calculator", text: localize(T("Gm.DcBaseOnly")), hint: format(T("Gm.DcBaseOnlyHint"), { base: rule.base ?? view.dc }), action: null });
    }
    if (view.started && !firstBlockingPhase(view, view.round + 1)) {
      warnings.push({ icon: "fa-solid fa-ban", text: localize(T("Gm.NoPhases")), hint: localize(T("Gm.NoPhasesHint")), action: null });
    }
    const controls = !view.started || current === null;
    return {
      phasesOn: view.enabled,
      phasesEditable: !view.started,
      dc: view.dc,
      dcRecalculate: baseCr || settings.dcSource === DC_SOURCES.baseCr
        ? { label: baseCr ? format(T("Gm.RecalculateLabel"), { base: rule.base ?? 0, cr: rule.referenceCr ?? 0 }) : localize(T("Gm.Recalculate")) }
        : null,
      controlsDisabled: controls,
      advanceStrong: waitingForDialog || (complete && !settings.autoAdvance),
      advanceLabel: current ? format(T("Gm.AdvanceLabel"), { phase: currentName }) : localize(T("Gm.Advance")),
      completeLabel: current ? format(T("Gm.CompleteLabel"), { phase: currentName }) : localize(T("Gm.Complete")),
      backLabel: current ? format(T("Gm.BackLabel"), { phase: currentName }) : localize(T("Gm.Back")),
      warnings,
    };
  }

  /** The core tracker's rule: every shown initiative with `places` decimals; anything else as it is. */
  static formatInitiative(value, places) {
    if (value === null || value === undefined) return "";
    return Number.isFinite(value) ? value.toFixed(places) : String(value);
  }
}
