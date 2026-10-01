import { BUILTIN_PHASE_IDS, I18N_ROOT, MODULE_ID, PHASE_COLORS, PHASE_ICONS, SETTINGS, TEMPLATE_ROOT } from "../constants/module-constants.js";
import { defaultPlan } from "../constants/default-phases.js";
import { SETTINGS_SCHEMA, SETTING_SECTIONS, coerceSetting } from "../constants/settings-schema.js";
import {
  addPhase,
  deletePhase,
  displayName,
  isBuiltin,
  movePhase,
  phaseById,
  phasesWithoutName,
  reorderIds,
  reorderPlan,
  restylePhase,
} from "../helpers/phase-plan.js";
import { getSetting, setSetting } from "../hooks/register-settings.js";
import SortableList from "./SortableList.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (key) => `${I18N_ROOT}.${key}`;
const HELP_TOPICS = [
  { key: "TurnEvents", icon: "fa-solid fa-arrows-rotate" },
  { key: "Unconfirmed", icon: "fa-solid fa-play" },
  { key: "Pending", icon: "fa-solid fa-dice-d20" },
  { key: "Conflicts", icon: "fa-solid fa-puzzle-piece" },
  { key: "Movement", icon: "fa-solid fa-shoe-prints" },
];

/**
 * The module's configuration screen. General: the settings of the schema
 * (world ones for the GM only). Phases: the phase template editor, a draft
 * until saved. Help: the GM's guide. Players see only their own settings.
 */
export default class PhaseConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-config`,
    classes: [MODULE_ID, "svi-config"],
    tag: "section",
    window: { title: T("Config.Title"), icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 600, height: "auto" },
    actions: {
      toggleSetting: PhaseConfigApp.#onToggleSetting,
      stepSetting: PhaseConfigApp.#onStepSetting,
      saveGeneral: PhaseConfigApp.#onSaveGeneral,
      addPhase: PhaseConfigApp.#onAddPhase,
      restorePhases: PhaseConfigApp.#onRestorePhases,
      deletePhase: PhaseConfigApp.#onDeletePhase,
      movePhase: PhaseConfigApp.#onMovePhase,
      pickIcon: PhaseConfigApp.#onPickLook,
      pickColor: PhaseConfigApp.#onPickLook,
      savePhases: PhaseConfigApp.#onSavePhases,
    },
  };

  static PARTS = {
    tabs: { template: `${TEMPLATE_ROOT}/phase-config/tabs.hbs` },
    general: { template: `${TEMPLATE_ROOT}/phase-config/general.hbs` },
    phases: { template: `${TEMPLATE_ROOT}/phase-config/phases.hbs`, scrollable: [".svi-phase-list"] },
    help: { template: `${TEMPLATE_ROOT}/phase-config/help.hbs` },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "general", icon: "fa-solid fa-gear", label: T("Config.Tabs.general") },
        { id: "phases", icon: "fa-solid fa-layer-group", label: T("Config.Tabs.phases") },
        { id: "help", icon: "fa-solid fa-circle-question", label: T("Config.Tabs.help") },
      ],
      initial: "general",
    },
  };

  /** Opens the screen (or brings it forward) on a tab; the Help tab starts focused on its first topic. */
  static async open(tab = "general") {
    const app = foundry.applications.instances.get(PhaseConfigApp.DEFAULT_OPTIONS.id) ?? new PhaseConfigApp();
    await app.render({ force: true, tab });
    if (tab === "help") app.element?.querySelector(".svi-help-topic summary")?.focus();
    return app;
  }

  /**
   * The settings menu builds a new instance on every click; while one is
   * already open, it takes the request instead, so its unsaved draft is kept.
   */
  render(options, _options) {
    const open = foundry.applications.instances.get(this.id);
    if (!this.rendered && open && open !== this) return open.render(options, _options);
    return super.render(options, _options);
  }

  /** The core marks tab buttons as pressed; these are ARIA tabs, so they carry the selection. */
  changeTab(tab, group, options) {
    super.changeTab(tab, group, options);
    for (const button of this.element.querySelectorAll(`.svi-tab[data-group="${group}"]`)) {
      button.setAttribute("aria-selected", String(button.dataset.tab === tab));
      button.removeAttribute("aria-pressed");
    }
  }

  #general = null;
  #plan = null;
  #dirty = false;
  #errors = new Set();
  #flash = null;
  #focus = null;

  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (!config || game.user.isGM) return config;
    return { ...config, tabs: config.tabs.filter((tab) => tab.id === "general"), initial: "general" };
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (!game.user.isGM) {
      delete parts.phases;
      delete parts.help;
    }
    return parts;
  }

  /** Listeners go on the part just rendered, so a partial render never binds twice. */
  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    if (partId === "phases") {
      SortableList.bind(element.querySelector(".svi-phase-list"), {
        itemSelector: ".svi-phase-item",
        handleSelector: ".svi-drag",
        onReorder: (dragged, before) => this.#reorder(dragged, before),
      });
      for (const input of element.querySelectorAll("input.svi-phase-name-input")) {
        input.addEventListener("input", () => this.#rename(input.closest("[data-id]").dataset.id, input.value));
      }
    }
    if (partId === "general") {
      for (const input of element.querySelectorAll("input[data-setting]")) {
        input.addEventListener("change", () => this.#setDraft(input.dataset.setting, input.value));
      }
    }
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (this.#focus) {
      this.element.querySelector(this.#focus)?.focus();
      this.#focus = null;
    }
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#general ??= Object.fromEntries(SETTINGS_SCHEMA.filter((e) => e.tab === "general").map((e) => [e.key, getSetting(e.key)]));
    this.#plan ??= getSetting(SETTINGS.phaseTemplate);
    return Object.assign(context, {
      isGM: game.user.isGM,
      sections: this.#generalSections(),
      phases: game.user.isGM ? this.#phaseRows() : [],
      dirty: this.#dirty,
      help: HELP_TOPICS.map((topic, index) => ({ ...topic, open: index === 0, title: T(`Help.${topic.key}.Title`), body: T(`Help.${topic.key}.Body`) })),
    });
  }

  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    if (partId in (context.tabs ?? {})) partContext.tab = context.tabs[partId];
    return partContext;
  }

  #generalSections() {
    const localize = (key) => game.i18n.localize(key);
    const visible = SETTINGS_SCHEMA.filter((e) => e.tab === "general" && (e.scope === "client" || game.user.isGM));
    return SETTING_SECTIONS.map((section) => ({
      title: T(`Config.Sections.${section}`),
      rows: visible
        .filter((e) => e.section === section)
        .map((entry) => {
          const value = this.#general[entry.key];
          const name = localize(T(`Settings.${entry.key}.Name`));
          const scope = localize(T(entry.scope === "world" ? "Config.ScopeWorld" : "Config.ScopeClient"));
          const range = entry.range ? ` · ${game.i18n.format(T("Config.Range"), entry.range)}` : "";
          return {
            key: entry.key,
            name,
            hint: localize(T(`Settings.${entry.key}.Hint`)),
            scopeLabel: `${scope}${range}`,
            scopeIcon: entry.scope === "world" ? "fa-solid fa-globe" : "fa-solid fa-user",
            isToggle: entry.type === "boolean",
            isNumber: entry.type === "number",
            value,
            on: value === true,
            stateLabel: localize(T(value ? "Config.On" : "Config.Off")),
            range: entry.range,
            decreaseLabel: game.i18n.format(T("Config.Decrease"), { name }),
            increaseLabel: game.i18n.format(T("Config.Increase"), { name }),
          };
        }),
    })).filter((section) => section.rows.length);
  }

  #phaseRows() {
    const localize = (key) => game.i18n.localize(key);
    const plan = this.#plan;
    const fast = plan.findIndex((p) => p.id === BUILTIN_PHASE_IDS.fast);
    const slow = plan.findIndex((p) => p.id === BUILTIN_PHASE_IDS.slow);
    return plan.map((phase, index) => {
      const name = displayName(phase, localize) || "";
      const format = (key) => game.i18n.format(T(`Config.Phases.${key}`), { name });
      return {
        id: phase.id,
        name: typeof phase.name === "string" ? phase.name : name,
        builtin: isBuiltin(phase),
        icon: phase.icon,
        color: phase.color,
        inBand: index >= fast && index <= slow,
        bandStart: index === fast,
        error: this.#errors.has(phase.id),
        flash: this.#flash === phase.id,
        canUp: !!movePhase(plan, phase.id, -1),
        canDown: !!movePhase(plan, phase.id, 1),
        dragLabel: format("Drag"),
        iconLabel: format("Icon"),
        upLabel: format("MoveUp"),
        downLabel: format("MoveDown"),
        deleteLabel: format("Delete"),
        icons: PHASE_ICONS.map((cls) => ({ cls, selected: cls === phase.icon })),
        colors: PHASE_COLORS.map((hex) => ({ hex, selected: hex.toLowerCase() === phase.color.toLowerCase() })),
      };
    });
  }

  #setDraft(key, raw) {
    const entry = SETTINGS_SCHEMA.find((e) => e.key === key);
    if (!entry) return;
    this.#general[key] = coerceSetting(entry, raw);
    this.render({ parts: ["general"] });
  }

  #changePlan(next, { focus = null } = {}) {
    this.#plan = next;
    this.#dirty = true;
    this.#errors.clear();
    this.#focus = focus;
    this.render({ parts: ["phases"] });
  }

  /** Typing the default name back (or nothing new) leaves the name translated per client. */
  #rename(id, value) {
    const phase = phaseById(this.#plan, id);
    if (!phase || isBuiltin(phase)) return;
    const translated = phase.nameKey ? game.i18n.localize(phase.nameKey) : null;
    const name = phase.name === null && value.trim() === translated ? null : value;
    this.#plan = this.#plan.map((p) => (p.id === id ? { ...p, name } : p));
    this.#dirty = true;
    if (this.#errors.delete(id)) {
      this.#focus = `[data-id="${id}"] input.svi-phase-name-input`;
      this.render({ parts: ["phases"] });
    }
    else this.element.querySelector(".svi-unsaved")?.removeAttribute("hidden");
  }

  #refuseOrder(id) {
    const name = (pid) => displayName(phaseById(this.#plan, pid), (key) => game.i18n.localize(key));
    ui.notifications.warn(game.i18n.format(T("Config.Phases.OrderRefused"), { fast: name("fast"), enemies: name("enemies"), slow: name("slow") }));
    this.#flash = id;
    this.render({ parts: ["phases"] });
    setTimeout(() => (this.#flash = null), 600);
  }

  #reorder(draggedId, beforeId) {
    const next = reorderPlan(this.#plan, reorderIds(this.#plan.map((p) => p.id), draggedId, beforeId));
    if (!next) return this.#refuseOrder(draggedId);
    return this.#changePlan(next);
  }

  /** Drafts live while the screen is open; reopening reads the saved settings again. */
  _onClose(options) {
    super._onClose(options);
    this.#general = null;
    this.#plan = null;
    this.#dirty = false;
    this.#errors.clear();
  }

  static async #confirm(title, body, confirmLabel) {
    return foundry.applications.api.DialogV2.confirm({
      classes: [MODULE_ID],
      window: { title },
      content: `<p>${body}</p>`,
      yes: { label: confirmLabel, icon: "fa-solid fa-check" },
      no: { label: T("Config.Phases.Cancel"), icon: "fa-solid fa-xmark", default: true },
      rejectClose: false,
    });
  }

  static #onToggleSetting(event, target) {
    const key = target.dataset.setting;
    this.#setDraft(key, !this.#general[key]);
  }

  static #onStepSetting(event, target) {
    const key = target.dataset.setting;
    this.#setDraft(key, Number(this.#general[key]) + Number(target.dataset.step));
  }

  static async #onSaveGeneral() {
    for (const [key, value] of Object.entries(this.#general)) {
      const entry = SETTINGS_SCHEMA.find((e) => e.key === key);
      if (entry.scope === "world" && !game.user.isGM) continue;
      if (getSetting(key) !== value) await setSetting(key, value);
    }
    ui.notifications.info(game.i18n.localize(T("Config.Saved")));
  }

  static #onAddPhase() {
    const ids = new Set(this.#plan.map((p) => p.id));
    let id;
    do id = foundry.utils.randomID(8);
    while (ids.has(id));
    this.#changePlan(addPhase(this.#plan, () => id), { focus: `[data-id="${id}"] input.svi-phase-name-input` });
  }

  static async #onRestorePhases() {
    const ok = await PhaseConfigApp.#confirm(T("Config.Phases.RestoreTitle"), game.i18n.localize(T("Config.Phases.RestoreBody")), T("Config.Phases.RestoreConfirm"));
    if (ok) this.#changePlan(defaultPlan());
  }

  static async #onDeletePhase(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const name = foundry.utils.escapeHTML(displayName(phaseById(this.#plan, id), (key) => game.i18n.localize(key)));
    const ok = await PhaseConfigApp.#confirm(T("Config.Phases.DeleteTitle"), game.i18n.format(T("Config.Phases.DeleteBody"), { name }), T("Config.Phases.DeleteConfirm"));
    const next = ok ? deletePhase(this.#plan, id) : null;
    if (next) this.#changePlan(next);
  }

  static #onMovePhase(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const step = Number(target.dataset.step);
    const next = movePhase(this.#plan, id, step);
    if (!next) return this.#refuseOrder(id);
    // Keyboard users keep the focus on the same button of the same phase.
    return this.#changePlan(next, { focus: `[data-id="${id}"] [data-action="movePhase"][data-step="${step}"]` });
  }

  static #onPickLook(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const look = target.dataset.icon ? { icon: target.dataset.icon } : { color: target.dataset.color };
    const next = restylePhase(this.#plan, id, look);
    if (next) this.#changePlan(next, { focus: `[data-id="${id}"] .svi-look summary` });
  }

  static async #onSavePhases() {
    const missing = phasesWithoutName(this.#plan);
    if (missing.length) {
      this.#errors = new Set(missing);
      this.#focus = `[data-id="${missing[0]}"] input.svi-phase-name-input`;
      this.render({ parts: ["phases"] });
      return;
    }
    const plan = this.#plan.map((p) => (typeof p.name === "string" ? { ...p, name: p.name.trim() } : p));
    await setSetting(SETTINGS.phaseTemplate, plan);
    this.#plan = plan;
    this.#dirty = false;
    this.render({ parts: ["phases"] });
    ui.notifications.info(game.i18n.localize(T("Config.Phases.Saved")));
  }
}
