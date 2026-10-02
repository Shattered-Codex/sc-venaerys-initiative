import { I18N_ROOT, MODULE_ID, ROLL_SOURCES, TEMPLATE_ROOT } from "../constants/module-constants.js";
import { projectionSettings, rollSettings } from "../hooks/register-settings.js";
import CombatPhaseProjector from "../services/CombatPhaseProjector.js";
import CombatSnapshot from "../services/CombatSnapshot.js";
import ErrorGuard from "../services/ErrorGuard.js";
import FoundryCompat from "../services/FoundryCompat.js";
import ThemeApplier from "../services/ThemeApplier.js";

/** The drag payload type of a combatant row; the canvas and sheets ignore it. */
const DRAG_TYPE = `application/x-${MODULE_ID}-combatant`;

const TEMPLATES = Object.freeze({
  tracker: `${TEMPLATE_ROOT}/combat-tracker/tracker.hbs`,
  row: `${TEMPLATE_ROOT}/combat-tracker/row.hbs`,
  panel: `${TEMPLATE_ROOT}/combat-tracker/panel.hbs`,
});

/**
 * The phases live in Foundry's own Combat Tracker (sidebar and popout). At
 * `setup`, after every system and module `init` and before the UI is built,
 * the tracker class the system registered is extended: in a phased combat the
 * `tracker` part lays the core's rows out in phase sections, and a `sviPanel`
 * part between `header` and `tracker` carries the GM's panel. A combat
 * without phases keeps the core template, the system's grouping and an empty
 * panel. The core still renders on every combat change; the module only
 * patches done marks in place. The GM moves a combatant to another phase with
 * the row's select, by dragging the row onto a phase, or with "Move to
 * phase…" in the row's context menu, and marks a group of identical
 * creatures done from the group's header. The "+" on an event phase adds
 * an event marker to it.
 */
export default class PhasedCombatTracker {
  static #installed = null;
  static #services = null;
  /** Open groups and finished phases, shared by the sidebar and the popout. */
  static expanded = new Set();

  static install(services) {
    PhasedCombatTracker.#services = services;
    PhasedCombatTracker.#installed = PhasedCombatTracker.extend(CONFIG.ui.combat);
    CONFIG.ui.combat = PhasedCombatTracker.#installed;
  }

  /** A tracker class registered after `setup` hides the phases; the rules still run. */
  static check() {
    if (CONFIG.ui.combat === PhasedCombatTracker.#installed) return true;
    console.warn(`${MODULE_ID} | Another module replaced the combat tracker: phases are not shown in it.`);
    if (game.user.isGM) ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Notifications.TrackerReplaced`));
    return false;
  }

  /** The tracker instances on screen: the sidebar tab and its popout. */
  static instances() {
    return [globalThis.ui?.combat, globalThis.ui?.combat?.popout].filter((app) => app?.rendered);
  }

  /** The current user's view of a combat, or null without one. */
  static project(combat) {
    if (!combat) return null;
    const { adapter, probe } = PhasedCombatTracker.#services;
    return CombatPhaseProjector.project(CombatSnapshot.from(combat, adapter), game.user, projectionSettings(), {
      localize: (key) => game.i18n.localize(key),
      format: (key, data) => game.i18n.format(key, data),
      decimals: CONFIG.Combat.initiative?.decimals ?? 2,
      waitingForDialog: game.user.isActiveGM && probe.isWaiting(combat.id),
      expanded: PhasedCombatTracker.expanded,
      dcName: (dc) => {
        const key = adapter.dcName(dc);
        return key ? game.i18n.localize(`${I18N_ROOT}.${key}`) : null;
      },
      rollProblem: PhasedCombatTracker.rollProblem(adapter),
    });
  }

  /** Why the system's own roll cannot work with the DC, when the GM uses it; null otherwise. */
  static rollProblem(adapter) {
    if (!game.user.isGM || rollSettings().source !== ROLL_SOURCES.system || !adapter.hasSystemRoll) return null;
    const key = adapter.systemRollProblem();
    return key ? game.i18n.localize(`${I18N_ROOT}.${key}`) : null;
  }

  /** The phase sections, each row joined with the core's own row context. */
  static layout(model, turns) {
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const join = (row) => {
      if (row.isGroup) return { ...row, children: row.children.map(join).filter(Boolean) };
      const turn = byId.get(row.id);
      if (!turn) return null;
      // Everyone in the phase acts: the core's single "active" row would mislead.
      const css = String(turn.css ?? "").split(" ").filter((c) => c && c !== "active").join(" ");
      return { ...turn, css, sviLabels: FoundryCompat.trackerRowLabels(turn), svi: row };
    };
    return model.phases.map((phase) => (phase.waitingForGm ? phase : { ...phase, rows: (phase.rows ?? []).map(join).filter(Boolean) }));
  }

  /** One combatant's row in a projected model, looking inside groups. */
  static rowOf(model, combatantId) {
    for (const phase of model?.phases ?? []) {
      for (const row of phase.rows ?? []) {
        const found = row.isGroup ? row.children.find((child) => child.id === combatantId) : row.id === combatantId ? row : null;
        if (found) return found;
      }
    }
    return null;
  }

  /** One group of identical creatures in a projected model, by its key. */
  static groupOf(model, key) {
    for (const phase of model?.phases ?? []) {
      const found = (phase.rows ?? []).find((row) => row.isGroup && row.key === key);
      if (found) return found;
    }
    return null;
  }

  /** "Move to phase…": the GM picks a phase (or automatic) for one combatant. */
  static async choosePhase(combat, combatantId) {
    const row = PhasedCombatTracker.rowOf(PhasedCombatTracker.project(combat), combatantId);
    if (!row?.select) return;
    const escape = (text) => foundry.utils.escapeHTML(String(text));
    const options = row.select.options.map((o) => `<option value="${escape(o.value)}"${o.selected ? " selected" : ""}>${escape(o.label)}</option>`);
    const phaseId = await foundry.applications.api.DialogV2.prompt({
      classes: [MODULE_ID, "svi-move-dialog"],
      window: { title: game.i18n.format(`${I18N_ROOT}.Tracker.MoveTitle`, { name: row.name }), icon: "fa-solid fa-layer-group" },
      content: `<div class="form-group"><label for="svi-move-phase">${escape(row.select.label)}</label>`
        + `<select id="svi-move-phase" name="phaseId">${options.join("")}</select></div>`,
      ok: { label: `${I18N_ROOT}.Tracker.Move`, icon: "fa-solid fa-check", callback: (event, button) => button.form.elements.phaseId.value },
      rejectClose: false,
      render: (event, dialog) => ThemeApplier.apply(dialog.element),
    });
    if (phaseId) PhasedCombatTracker.#services.commands.execute("assign", combat, { combatantId, phaseId: phaseId === "auto" ? null : phaseId });
  }

  /** Done marks changed and nothing else: rows, toggles and counters are patched in place, on every instance. */
  static patchDone(combatantIds) {
    const apps = PhasedCombatTracker.instances();
    const combat = globalThis.ui?.combat?.viewed ?? null;
    if (!apps.length || !combat || !CombatSnapshot.isPhased(combat)) return false;
    const model = PhasedCombatTracker.project(combat);
    const rows = new Map();
    const collect = (row) => (row.isGroup ? row.children.forEach(collect) : rows.set(row.id, row));
    for (const phase of model.phases) (phase.rows ?? []).forEach(collect);
    for (const { element } of apps) {
      for (const phase of model.phases) {
        if (phase.waitingForGm) continue;
        element.querySelector(`[data-phase-id="${phase.id}"]`)?.classList.toggle("svi-complete", phase.complete);
        if (phase.count) element.querySelector(`[data-phase-count="${phase.id}"]`)?.replaceChildren(phase.count);
        for (const row of phase.rows ?? []) {
          if (row.isGroup) element.querySelector(`[data-group-key="${row.key}"] .svi-group-count`)?.replaceChildren(row.count);
        }
      }
      for (const id of combatantIds) {
        const row = rows.get(id);
        if (!row) continue;
        for (const li of element.querySelectorAll(`.combatant[data-combatant-id="${id}"]`)) {
          li.classList.toggle("svi-done", row.done);
          for (const root of li.querySelectorAll(`.${MODULE_ID}`)) root.classList.toggle("svi-done", row.done);
          const toggle = li.querySelector("button[data-action=sviToggleDone]");
          const button = row.doneButton ?? row.skipButton;
          if (!toggle || !button) continue;
          toggle.setAttribute("aria-pressed", String(button.pressed));
          toggle.setAttribute("aria-label", button.label);
          toggle.dataset.tooltip = button.label;
        }
      }
    }
    return true;
  }

  /** The subclass of the system's tracker. */
  static extend(Base) {
    const services = () => PhasedCombatTracker.#services;
    const combatOf = (app) => app.viewed ?? null;

    return class extends Base {
      static DEFAULT_OPTIONS = {
        actions: {
          sviToggleDone(event, target) {
            const combat = combatOf(this);
            const combatantId = target.closest("[data-combatant-id]")?.dataset.combatantId;
            if (!combat || !combatantId) return;
            services().doneMarkers.setDone(combat, combatantId, target.getAttribute("aria-pressed") !== "true");
          },
          sviAdvance(event, target) {
            if (!target.disabled) services().commands.execute("advance", combatOf(this), { force: true });
          },
          sviComplete(event, target) {
            if (!target.disabled) services().commands.execute("complete", combatOf(this));
          },
          sviBack(event, target) {
            if (!target.disabled) services().commands.execute("back", combatOf(this));
          },
          sviTogglePhases(event, target) {
            const combat = combatOf(this);
            if (!combat || target.disabled || combat.started) return;
            services().commands.execute("toggle", combat, { enabled: target.getAttribute("aria-checked") !== "true" });
          },
          sviStepDc(event, target) {
            const combat = combatOf(this);
            if (combat) services().commands.execute("setDc", combat, { value: CombatSnapshot.dcOf(combat) + Number(target.dataset.step) });
          },
          sviRecalculateDc() {
            const combat = combatOf(this);
            if (combat) services().commands.execute("recalculateDc", combat);
          },
          sviToggleExpand(event, target) {
            const key = target.dataset.key;
            if (PhasedCombatTracker.expanded.has(key)) PhasedCombatTracker.expanded.delete(key);
            else PhasedCombatTracker.expanded.add(key);
            this.render();
          },
          sviCompleteGroup(event, target) {
            const combat = combatOf(this);
            const group = PhasedCombatTracker.groupOf(PhasedCombatTracker.project(combat), target.dataset.key);
            if (group) services().doneMarkers.markGroup(combat, group.children.map((child) => child.id));
          },
          sviRoll(event, target) {
            const combat = combatOf(this);
            if (combat) services().roller.roll(combat, [target.dataset.combatantId]);
          },
          sviRollMine() {
            const combat = combatOf(this);
            if (combat) services().roller.rollOwn(combat);
          },
          sviRollPending() {
            const combat = combatOf(this);
            if (combat) services().roller.rollAll(combat);
          },
          sviAddMarker(event, target) {
            const combat = combatOf(this);
            if (combat) services().commands.execute("addMarker", combat, { phaseId: target.dataset.phaseId });
          },
          sviHelp() {
            services().openHelp();
          },
          // Keeps a click on the phase select from activating the combatant under it.
          sviNoop() {},
        },
      };

      get sviPhased() {
        return CombatSnapshot.isPhased(combatOf(this));
      }

      _configureRenderParts(options) {
        const parts = foundry.utils.deepClone(super._configureRenderParts(options));
        const out = {};
        for (const [id, part] of Object.entries(parts)) {
          // Always present, so the panel never moves below the footer.
          if (id === "tracker") out.sviPanel = { template: TEMPLATES.panel, templates: [] };
          out[id] = part;
        }
        out.sviPanel ??= { template: TEMPLATES.panel, templates: [] };
        if (this.sviPhased && out.tracker) {
          out.tracker = { ...out.tracker, template: TEMPLATES.tracker, templates: [...(out.tracker.templates ?? []), TEMPLATES.row] };
        }
        return out;
      }

      async _prepareContext(options) {
        const context = await super._prepareContext(options);
        context.sviTheme = ThemeApplier.current();
        context.svi = ErrorGuard.wrap("tracker-view", () => PhasedCombatTracker.project(combatOf(this)), () => null)();
        return context;
      }

      async _prepareTrackerContext(context, options) {
        const result = await super._prepareTrackerContext(context, options);
        if (!this.sviPhased || !context.svi || !context.turns) return result;
        context.sviPhases = PhasedCombatTracker.layout(context.svi, context.turns);
        return result;
      }

      _attachFrameListeners() {
        super._attachFrameListeners();
        this.element.addEventListener("change", (event) => this.#sviOnChange(event));
        this.element.addEventListener("dragstart", (event) => this.#sviOnDragStart(event));
        this.element.addEventListener("dragover", (event) => this.#sviOnDragOver(event));
        this.element.addEventListener("dragleave", (event) => this.#sviOnDragLeave(event));
        this.element.addEventListener("drop", (event) => this.#sviOnDrop(event));
        this.element.addEventListener("dragend", () => this.#sviClearDrop());
      }

      _getEntryContextOptions() {
        const entries = super._getEntryContextOptions();
        entries.push(FoundryCompat.contextEntry({
          label: `${I18N_ROOT}.Tracker.MoveToPhase`,
          icon: "fa-solid fa-layer-group",
          visible: () => game.user.isGM && this.sviPhased,
          onClick: (li) => PhasedCombatTracker.choosePhase(combatOf(this), li.dataset.combatantId),
        }));
        return entries;
      }

      /** The phase section under a drag of a combatant row, or null. */
      #sviDropPhase(event) {
        if (!game.user.isGM || !this.sviPhased || !event.dataTransfer?.types.includes(DRAG_TYPE)) return null;
        return event.target.closest?.("li.svi-phase[data-phase-id]") ?? null;
      }

      #sviOnDragStart(event) {
        const li = event.target.closest?.(".svi-phased-tracker li.combatant[draggable=true]");
        if (!li || !game.user.isGM) return;
        event.dataTransfer.setData(DRAG_TYPE, li.dataset.combatantId);
        event.dataTransfer.effectAllowed = "move";
      }

      #sviOnDragOver(event) {
        const phase = this.#sviDropPhase(event);
        if (!phase) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        for (const other of this.element.querySelectorAll(".svi-drop-target")) if (other !== phase) other.classList.remove("svi-drop-target");
        phase.classList.add("svi-drop-target");
      }

      #sviOnDragLeave(event) {
        const phase = this.#sviDropPhase(event);
        if (phase && !phase.contains(event.relatedTarget)) phase.classList.remove("svi-drop-target");
      }

      #sviOnDrop(event) {
        const phase = this.#sviDropPhase(event);
        this.#sviClearDrop();
        if (!phase) return;
        event.preventDefault();
        const combatantId = event.dataTransfer.getData(DRAG_TYPE);
        const from = this.element.querySelector(`li.combatant[data-combatant-id="${combatantId}"]`)?.closest("li.svi-phase");
        if (!combatantId || from === phase) return;
        services().commands.execute("assign", combatOf(this), { combatantId, phaseId: phase.dataset.phaseId });
      }

      #sviClearDrop() {
        for (const phase of this.element.querySelectorAll(".svi-drop-target")) phase.classList.remove("svi-drop-target");
      }

      #sviOnChange(event) {
        const combat = combatOf(this);
        if (!combat || !game.user.isGM) return;
        const select = event.target.closest?.("select.svi-phase-select");
        if (select) {
          const combatantId = select.closest("[data-combatant-id]")?.dataset.combatantId;
          services().commands.execute("assign", combat, { combatantId, phaseId: select.value === "auto" ? null : select.value });
          return;
        }
        if (event.target.matches?.("input.svi-dc-input")) {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) services().commands.execute("setDc", combat, { value });
        }
      }

      /** dnd5e regroups identical creatures after every render; with phases, the module groups inside each phase. */
      renderGroups(html) {
        if (this.sviPhased) return undefined;
        return super.renderGroups?.(html);
      }
    };
  }
}
