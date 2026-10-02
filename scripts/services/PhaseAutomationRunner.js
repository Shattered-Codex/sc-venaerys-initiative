import { I18N_ROOT, MODULE_ID, OPERATION_KEY } from "../constants/module-constants.js";
import { consequencesToRun, normalizeConsequences } from "../helpers/consequence-kinds.js";
import { displayName, phaseById } from "../helpers/phase-plan.js";
import { currentPhaseId } from "../helpers/phase-progression.js";
import { startKey, startedPhase } from "../helpers/phase-triggers.js";
import { visibleCombat } from "../helpers/phase-visibility.js";
import CombatSnapshot from "./CombatSnapshot.js";

const escape = (text) => foundry.utils.escapeHTML(String(text ?? ""));

/**
 * Runs a phase's "actions when it starts" on every client, from the same
 * combat update, with no socket: "gm" actions on the active GM only, "local"
 * ones where someone of the phase is visible (a hidden boss's sound never
 * reaches a player). Each phase runs once per round per client; a failing
 * action is reported to the GM and the rest still run. Macros run only when
 * a GM wrote them.
 */
export default class PhaseAutomationRunner {
  #ran = new Set();

  constructor({ adapter }) {
    this.adapter = adapter;
  }

  onUpdateCombat(combat, changed, options) {
    if (!CombatSnapshot.isPhased(combat) || !("turn" in changed || "round" in changed)) return undefined;
    const view = CombatSnapshot.from(combat, this.adapter);
    const phaseId = startedPhase({
      reason: options?.[OPERATION_KEY]?.reason,
      nativeStart: combat.previous?.round === 0 && combat.round >= 1 && !options?.[OPERATION_KEY],
      before: { round: combat.previous?.round, phaseId: CombatSnapshot.previousPhaseOf(combat) },
      after: { round: view.round, phaseId: currentPhaseId(view) },
    });
    if (!phaseId) return undefined;
    const key = startKey(combat.id, view.round, phaseId);
    if (this.#ran.has(key)) return undefined;
    this.#ran.add(key);
    return this.run(combat, view, phaseId);
  }

  async run(combat, view, phaseId) {
    const phase = phaseById(view.plan, phaseId);
    const rows = normalizeConsequences(phase?.onEnter);
    if (!rows.length) return;
    const isGM = game.user.isGM;
    const seen = visibleCombat(view, { isGM, showDcToPlayers: false }).phases.some((p) => p.phase?.id === phaseId && p.members.length);
    const toRun = consequencesToRun(rows, {
      visible: isGM || seen,
      isGM,
      isActiveGM: game.user.isActiveGM,
      isModuleActive: (id) => Boolean(game.modules.get(id)?.active),
    });
    const name = displayName(phase, (key) => game.i18n.localize(key));
    const members = view.combatants.filter((c) => c.phase === phaseId && (isGM || c.visible))
      .map((c) => combat.combatants.get(c.id)).filter(Boolean);
    const context = { combat, phase: { ...phase, displayName: name }, round: view.round, combatants: members };
    for (const row of toRun) {
      try {
        await PhaseAutomationRunner.#HANDLERS[row.kind](row.params, { ...context, row });
      } catch (error) {
        console.error(`${MODULE_ID} | Phase action "${row.kind}" failed.`, error);
        if (isGM) ui.notifications.warn(game.i18n.format(`${I18N_ROOT}.Automation.Failed`, { phase: name, kind: game.i18n.localize(`${I18N_ROOT}.Automation.Kinds.${row.kind}`) }));
      }
    }
  }

  static #HANDLERS = {
    screenMessage: (params, { phase }) => {
      if (params.text) ui.notifications.info(`${phase.displayName}: ${params.text}`);
    },

    sound: (params) => {
      if (params.src) return foundry.audio.AudioHelper.play({ src: params.src, volume: params.volume / 100, loop: false }, false);
      return undefined;
    },

    hook: (params, { combat, phase, round, combatants }) => {
      if (params.name) Hooks.callAll(params.name, { combat, phase, round, combatants });
    },

    chatMessage: (params, { phase, combatants }) => {
      if (!params.text) return undefined;
      // A public chat card names its phase. Keep it with the GMs when even one
      // member is hidden, since the GM cannot know every player's tracker view.
      const gmOnly = params.audience === "gm" || combatants.some((member) => member.hidden);
      const whisper = gmOnly ? game.users.filter((user) => user.isGM).map((user) => user.id) : [];
      return ChatMessage.implementation.create({
        content: `<h3>${escape(phase.displayName)}</h3><p>${escape(params.text)}</p>`,
        speaker: { alias: phase.displayName },
        whisper,
      });
    },

    macro: async (params, { combat, phase, round, combatants }) => {
      if (!params.macroUuid) return;
      const macro = await fromUuid(params.macroUuid);
      if (!macro) throw new Error(`No macro at ${params.macroUuid}`);
      // A macro runs on the active GM with a GM's rights: only a GM may have written it.
      if (!macro.author?.isGM) {
        ui.notifications.warn(game.i18n.format(`${I18N_ROOT}.Automation.MacroRefused`, { macro: macro.name }));
        return;
      }
      await macro.execute({ combat, phase, round, combatants });
    },

    rollTable: async (params) => {
      if (!params.tableUuid) return;
      const table = await fromUuid(params.tableUuid);
      if (!table) throw new Error(`No roll table at ${params.tableUuid}`);
      await table.draw();
    },

    jumpScare: (params) => game.modules.get("sc-jump-scare")?.api?.play(params.scareId),

    puzzle: (params) => {
      const api = game.modules.get("sc-puzzle-engine")?.api;
      const method = { open: "openPuzzle", arm: "armPuzzle", trigger: "triggerPuzzle" }[params.action];
      return api?.[method]?.(params.puzzleUuid);
    },

    /** SC Resources: each write carries an operation id, so a repeated start changes nothing twice. */
    resource: async (params, { combat, phase, round, combatants, row }) => {
      const api = game.modules.get("sc-resources")?.api;
      if (!api || !params.resourceId) return;
      for (const actor of await PhaseAutomationRunner.#resourceTargets(params, combat, combatants)) {
        const options = { reason: phase.displayName, operationId: `svi-${combat.id}-${round}-${phase.id}-${row.id}-${actor.id}` };
        const result = params.operation === "restore"
          ? await api.restore(actor, params.resourceId, options)
          : await api[params.operation](actor, params.resourceId, params.amount, options);
        if (result && result.ok === false) console.warn(`${MODULE_ID} | SC Resources refused: ${result.reason}`);
      }
    },
  };

  static async #resourceTargets(params, combat, members) {
    if (params.target === "actor") {
      const actor = params.actorUuid ? await fromUuid(params.actorUuid) : null;
      return actor ? [actor] : [];
    }
    const pool = params.target === "members" ? members : combat.combatants.contents;
    const actors = pool.filter((c) => c.actor && (params.target !== "party" || c.hasPlayerOwner)).map((c) => c.actor);
    return [...new Set(actors)];
  }
}
