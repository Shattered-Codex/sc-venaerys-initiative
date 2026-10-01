import { I18N_ROOT, MODULE_ID, TEMPLATE_ROOT } from "../constants/module-constants.js";
import { projectionSettings } from "../hooks/register-settings.js";
import CombatPhaseProjector from "../services/CombatPhaseProjector.js";
import CombatSnapshot from "../services/CombatSnapshot.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The phase window: the combat as phases, who is done in each, the pending
 * strip and, for the GM, the combat panel. It shows `game.combat` and holds
 * no combat state of its own: only which groups and finished phases are
 * open, which survives every partial render.
 */
export default class PhaseTrackerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-phases`,
    classes: [MODULE_ID, "svi-phase-window"],
    tag: "section",
    window: { title: `${I18N_ROOT}.Tracker.Title`, icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 400, height: 640 },
    actions: {
      toggleDone: PhaseTrackerApp.#onToggleDone,
      advance: PhaseTrackerApp.#onCommand,
      complete: PhaseTrackerApp.#onCommand,
      back: PhaseTrackerApp.#onCommand,
      togglePhases: PhaseTrackerApp.#onTogglePhases,
      stepDc: PhaseTrackerApp.#onStepDc,
      toggleExpand: PhaseTrackerApp.#onToggleExpand,
      help: PhaseTrackerApp.#onHelp,
    },
  };

  static PARTS = {
    header: { template: `${TEMPLATE_ROOT}/phase-tracker/header.hbs` },
    phases: { template: `${TEMPLATE_ROOT}/phase-tracker/phases.hbs`, templates: [`${TEMPLATE_ROOT}/phase-tracker/row.hbs`], scrollable: [""] },
    pending: { template: `${TEMPLATE_ROOT}/phase-tracker/pending.hbs` },
  };

  /** Open groups and finished phases, by key. */
  #expanded = new Set();
  /** The combat shown by the last render. */
  combatId = null;

  constructor({ services, ...options } = {}) {
    super(options);
    this.services = services;
  }

  /** The current user's view of `game.combat`, or null without a combat. */
  model() {
    const combat = game.combat;
    if (!combat) return null;
    const { adapter, probe } = this.services;
    const view = CombatSnapshot.from(combat, adapter);
    return CombatPhaseProjector.project(view, game.user, projectionSettings(), {
      localize: (key) => game.i18n.localize(key),
      format: (key, data) => game.i18n.format(key, data),
      decimals: CONFIG.Combat.initiative?.decimals ?? 2,
      waitingForDialog: game.user.isActiveGM && probe.isWaiting(combat.id),
      expanded: this.#expanded,
    });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const model = this.model();
    this.combatId = game.combat?.id ?? null;
    return Object.assign(context, { hasCombat: !!model }, model ?? {});
  }

  /** Change events, bound once on the window for every render to come. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onChange(event));
  }

  #onChange(event) {
    const combat = game.combat;
    if (!combat || !game.user.isGM) return;
    const select = event.target.closest("select.svi-phase-select");
    if (select) {
      const combatantId = select.closest("[data-combatant-id]")?.dataset.combatantId;
      const phaseId = select.value === "auto" ? null : select.value;
      this.services.commands.execute("assign", combat, { combatantId, phaseId });
      return;
    }
    if (event.target.matches("input[name=dc]")) {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) this.services.commands.execute("setDc", combat, { value });
    }
  }

  /**
   * A done mark changed and nothing else: patch the rows and counters in
   * place, no template. Row state lives in a class and the toggle's ARIA
   * attributes, so nothing else in the row needs to change.
   */
  patchDone(combatantIds) {
    const model = this.model();
    if (!model || !this.element) return false;
    const rows = new Map();
    for (const phase of model.phases) {
      this.element.querySelector(`[data-phase-id="${phase.id}"]`)?.classList.toggle("svi-complete", phase.complete);
      for (const row of phase.rows ?? []) {
        if (row.isGroup) {
          for (const child of row.children) rows.set(child.id, child);
          this.element.querySelector(`[data-group-key="${row.key}"] .svi-group-count`)?.replaceChildren(row.count);
        } else rows.set(row.id, row);
      }
      if (phase.count) this.element.querySelector(`[data-phase-count="${phase.id}"]`)?.replaceChildren(phase.count);
    }
    for (const id of combatantIds) {
      const row = rows.get(id);
      if (!row) continue;
      for (const element of this.element.querySelectorAll(`.svi-row[data-combatant-id="${id}"]`)) {
        element.classList.toggle("svi-done", row.done);
        const toggle = element.querySelector("button[data-action=toggleDone]");
        const button = row.doneButton ?? row.skipButton;
        if (toggle && button) {
          toggle.setAttribute("aria-pressed", String(button.pressed));
          toggle.setAttribute("aria-label", button.label);
          toggle.dataset.tooltip = button.label;
        }
      }
    }
    return true;
  }

  static #onToggleDone(event, target) {
    const combat = game.combat;
    const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
    if (!combat || !combatantId) return;
    const pressed = target.getAttribute("aria-pressed") === "true";
    this.services.doneMarkers.setDone(combat, combatantId, !pressed);
  }

  static #onCommand(event, target) {
    const combat = game.combat;
    if (!combat || target.disabled) return;
    const action = target.dataset.action;
    this.services.commands.execute(action, combat, action === "advance" ? { force: true } : {});
  }

  static #onTogglePhases(event, target) {
    const combat = game.combat;
    if (!combat || target.disabled || combat.started) return;
    this.services.commands.execute("toggle", combat, { enabled: target.getAttribute("aria-checked") !== "true" });
  }

  static #onStepDc(event, target) {
    const combat = game.combat;
    if (!combat) return;
    const value = CombatSnapshot.dcOf(combat) + Number(target.dataset.step);
    this.services.commands.execute("setDc", combat, { value });
  }

  static #onToggleExpand(event, target) {
    const key = target.dataset.key;
    if (this.#expanded.has(key)) this.#expanded.delete(key);
    else this.#expanded.add(key);
    this.render({ parts: ["phases"] });
  }

  static #onHelp() {
    this.services.openHelp?.();
  }
}
