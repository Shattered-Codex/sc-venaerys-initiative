import { BUILTIN_PHASE_IDS, I18N_ROOT, MODULE_ID, PHASE_COLORS, PHASE_COLOR_NAMES, PHASE_ICONS, SETTINGS, SOUND_MODES, TEMPLATE_ROOT, iconName } from "../constants/module-constants.js";
import { defaultPlan } from "../constants/default-phases.js";
import { SETTINGS_SCHEMA, SETTING_SECTIONS, SETTING_TABS, coerceSetting, schemaEntry } from "../constants/settings-schema.js";
import {
  addPhase,
  deletePhase,
  displayName,
  isBuiltin,
  isEventPhase,
  movePhase,
  phaseById,
  phasesWithoutName,
  reorderIds,
  reorderPlan,
  restylePhase,
} from "../helpers/phase-plan.js";
import { BANNER_COLOR_FIELDS, BANNER_PRESETS, BANNER_STYLES, bannerVariables, copyBannerTheme, normalizeBannerThemes } from "../helpers/banner-themes.js";
import { TRANSFER_KINDS, exportFileName, exportPayload, mergeBannerThemes, parseImport } from "../helpers/config-transfer.js";
import { CONSEQUENCE_KINDS, CONSEQUENCE_KIND_IDS, normalizeConsequence, normalizeConsequences } from "../helpers/consequence-kinds.js";
import { phaseSound, setPhaseSound } from "../helpers/phase-sound.js";
import { THEME_FAMILIES, isLegacyTheme, normalizeTheme } from "../helpers/themes.js";
import { customThemeColors, getSetting, registeredDefault, setSetting } from "../hooks/register-settings.js";
import PhaseBanner from "../services/PhaseBanner.js";
import ThemeApplier from "../services/ThemeApplier.js";
import SortableList from "./SortableList.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const T = (key) => `${I18N_ROOT}.${key}`;
const PART = (name) => `${TEMPLATE_ROOT}/phase-config/${name}.hbs`;
/** The journal page type the SC Puzzle Engine registers for its puzzles. */
const PUZZLE_PAGE_TYPE = "sc-puzzle-engine.puzzle";
const HELP_TOPICS = [
  { key: "TurnEvents", icon: "fa-solid fa-arrows-rotate" },
  { key: "Unconfirmed", icon: "fa-solid fa-play" },
  { key: "Moving", icon: "fa-solid fa-layer-group" },
  { key: "Pending", icon: "fa-solid fa-dice-d20" },
  { key: "Conflicts", icon: "fa-solid fa-puzzle-piece" },
  { key: "Movement", icon: "fa-solid fa-shoe-prints" },
];
const SETTING_FIELD = "[data-setting]";

/**
 * The module's configuration screen, archetype B "Sidebar Tabs" like the
 * other Shattered Codex option windows: a rail of tabs, one panel each, and a
 * footer with the unsaved-changes pill, Reset tab, Close and Save. Tabs and
 * rows come from the settings schema. Each tab is its own render part, so
 * editing the phase list never re-renders (and loses) another tab's unsaved
 * fields; switching tabs only touches the DOM. Players get "This client".
 */
export default class PhaseConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** The running system's default roll formula, shown in the empty formula field; set at `init`. */
  static defaultFormula = () => "";

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-config`,
    classes: [MODULE_ID, "svi-config"],
    tag: "section",
    window: { title: T("Config.Title"), icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 900, height: 640 },
    actions: {
      sviTab: PhaseConfigApp.#onTab,
      sviResetTab: PhaseConfigApp.#onResetTab,
      sviClose: PhaseConfigApp.#onClose,
      sviSave: PhaseConfigApp.#onSave,
      addPhase: PhaseConfigApp.#onAddPhase,
      addEventPhase: PhaseConfigApp.#onAddEventPhase,
      deletePhase: PhaseConfigApp.#onDeletePhase,
      movePhase: PhaseConfigApp.#onMovePhase,
      pickIcon: PhaseConfigApp.#onPickLook,
      pickColor: PhaseConfigApp.#onPickLook,
      moveAction: PhaseConfigApp.#onMoveAction,
      deleteAction: PhaseConfigApp.#onDeleteAction,
      previewMessage: PhaseConfigApp.#onPreviewMessage,
      pickFile: PhaseConfigApp.#onPickFile,
      previewSound: PhaseConfigApp.#onPreviewSound,
      addBanner: PhaseConfigApp.#onAddBanner,
      exportConfig: PhaseConfigApp.#onExport,
      importConfig: PhaseConfigApp.#onImport,
      copyBanner: PhaseConfigApp.#onCopyBanner,
      deleteBanner: PhaseConfigApp.#onDeleteBanner,
      previewBanner: PhaseConfigApp.#onPreviewBanner,
    },
  };

  static PARTS = {
    rail: { template: PART("rail") },
    world: { template: PART("settings"), scrollable: [""] },
    appearance: { template: PART("appearance"), scrollable: [""] },
    phases: { template: PART("phases"), scrollable: [".svi-phase-list"] },
    banners: { template: PART("banners"), scrollable: [""] },
    client: { template: PART("settings"), scrollable: [""] },
    help: { template: PART("help"), scrollable: [""] },
    footer: { template: PART("footer") },
  };

  /** Opens the screen (or brings it forward) on a tab; the Help tab starts focused on its first topic. */
  static async open(tab = null) {
    const app = foundry.applications.instances.get(PhaseConfigApp.DEFAULT_OPTIONS.id) ?? new PhaseConfigApp();
    if (tab) app.#activeTab = tab;
    if (app.rendered) {
      app.#showTab(app.#activeTab);
      app.bringToFront?.();
    } else await app.render({ force: true });
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

  #activeTab = null;
  #plan = null;
  #phasesDirty = false;
  /** The GM's banner themes as edited here, saved with the rest. */
  #banners = null;
  #bannersDirty = false;
  #errors = new Set();
  #flash = null;
  #focus = null;
  /** Phases whose "actions when it starts" are open, kept across renders. */
  #openActions = new Set();
  /** Setting values as last rendered or saved, for the pill and the tab dots. */
  #baseline = new Map();

  #tabs() {
    return SETTING_TABS.filter((tab) => game.user.isGM || !tab.gm);
  }

  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const allowed = new Set(this.#tabs().map((tab) => tab.id));
    for (const tab of SETTING_TABS) if (!allowed.has(tab.id)) delete parts[tab.id];
    return parts;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tabs = this.#tabs();
    if (!tabs.some((tab) => tab.id === this.#activeTab)) this.#activeTab = tabs[0].id;
    this.#plan ??= getSetting(SETTINGS.phaseTemplate);
    this.#banners ??= getSetting(SETTINGS.bannerThemes);
    return Object.assign(context, {
      tabs: tabs.map((tab) => ({ ...tab, label: T(`Config.Tabs.${tab.id}`), active: tab.id === this.#activeTab })),
      tabsLabel: T("Config.TabsLabel"),
    });
  }

  async _preparePartContext(partId, context, options) {
    const part = await super._preparePartContext(partId, context, options);
    const tab = SETTING_TABS.find((t) => t.id === partId);
    if (!tab) return part;
    part.tab = { id: tab.id, active: tab.id === this.#activeTab, title: T(`Config.Tabs.${tab.id}`), hint: T(`Config.TabHints.${tab.id}`) };
    part.sections = tab.settings && tab.id !== "appearance" ? this.#sections(tab.id) : [];
    part.families = tab.id === "appearance" ? this.#themeFamilies() : [];
    part.themeDefault = registeredDefault(SETTINGS.theme);
    part.customColors = tab.id === "appearance" ? PhaseConfigApp.#customColorRows() : [];
    part.phases = tab.id === "phases" ? this.#phaseRows() : [];
    part.banners = tab.id === "banners" ? this.#bannerContext() : null;
    part.help = tab.id === "help" ? HELP_TOPICS.map((topic, index) => ({ ...topic, open: index === 0, title: T(`Help.${topic.key}.Title`), body: T(`Help.${topic.key}.Body`) })) : [];
    return part;
  }

  /** Listeners go on the part just rendered, so a partial render never binds twice. */
  _attachPartListeners(partId, element, options) {
    super._attachPartListeners(partId, element, options);
    if (partId !== "phases") return;
    SortableList.bind(element.querySelector(".svi-phase-list"), {
      itemSelector: ".svi-phase-item",
      handleSelector: ".svi-drag",
      onReorder: (dragged, before) => this.#reorder(dragged, before),
    });
    for (const input of element.querySelectorAll("input.svi-phase-name-input")) {
      input.addEventListener("input", () => this.#rename(input.closest("[data-id]").dataset.id, input.value));
    }
    for (const details of element.querySelectorAll("details.svi-actions")) {
      details.addEventListener("toggle", () => {
        const id = details.closest("[data-id]").dataset.id;
        if (details.open) this.#openActions.add(id);
        else this.#openActions.delete(id);
      });
    }
    for (const input of element.querySelectorAll("input[data-drop-uuid]")) {
      input.addEventListener("dragover", (event) => event.preventDefault());
      input.addEventListener("drop", (event) => this.#onDropUuid(event, input));
    }
  }

  /** Form events and the rail's keyboard, bound once on the window. */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onFieldChange(event));
    this.element.addEventListener("input", (event) => {
      // A color changes while the picker is open: the preview follows it.
      if (event.target.dataset?.customColor) this.#previewCustomColors();
      if (event.target.dataset?.bannerField) this.#editBanner(event.target);
      this.#refreshState();
    });
    this.element.addEventListener("keydown", (event) => this.#onRailKey(event));
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    ThemeApplier.apply(this.element);
    const settingsParts = SETTING_TABS.filter((tab) => tab.settings).map((tab) => tab.id);
    if (!options.parts || options.parts.some((part) => settingsParts.includes(part))) this.#captureBaseline();
    this.#refreshState();
    if (this.#focus) {
      this.element.querySelector(this.#focus)?.focus();
      this.#focus = null;
    }
  }

  /** Drafts live while the screen is open; closing without saving also ends a theme preview. */
  _onClose(options) {
    super._onClose(options);
    ThemeApplier.endPreview();
    this.#plan = null;
    this.#phasesDirty = false;
    this.#banners = null;
    this.#bannersDirty = false;
    this.#errors.clear();
    this.#baseline.clear();
    this.#openActions.clear();
  }

  /* ------------------------------------------------------------------ */
  /*  Context                                                           */
  /* ------------------------------------------------------------------ */

  #sections(tabId) {
    const localize = (key) => game.i18n.localize(key);
    const entries = SETTINGS_SCHEMA.filter((e) => e.tab === tabId && (e.scope === "client" || game.user.isGM));
    const sections = SETTING_SECTIONS.map((section) => ({
      title: T(`Config.Sections.${section}`),
      rows: entries
        .filter((e) => e.section === section)
        .map((entry) => {
          const name = localize(T(`Settings.${entry.key}.Name`));
          const value = getSetting(entry.key);
          return {
            key: entry.key,
            name,
            hint: localize(T(`Settings.${entry.key}.Hint`)),
            range: entry.range ? game.i18n.format(T("Config.Range"), entry.range) : "",
            isToggle: entry.type === "boolean",
            isNumber: entry.type === "number",
            isSelect: entry.type === "choice",
            isText: entry.type === "string",
            placeholder: entry.key === SETTINGS.rollFormula ? PhaseConfigApp.defaultFormula() : "",
            choices: entry.type === "choice"
              ? entry.choices.map((choice) => ({ value: choice, label: localize(T(`Settings.${entry.key}.Choices.${choice}`)), selected: choice === value }))
              : [],
            value,
            defaultValue: String(registeredDefault(entry.key)),
            min: entry.range?.min,
            max: entry.range?.max,
            step: entry.range?.step ?? 1,
          };
        }),
    })).filter((section) => section.rows.length);
    // A tab with a single section needs no heading under its own title.
    return sections.map((section) => ({ ...section, showTitle: sections.length > 1 }));
  }

  /** The three color fields of the custom theme. */
  static #customColorRows() {
    return [SETTINGS.customAccent, SETTINGS.customBackground, SETTINGS.customText].map((key) => ({
      key,
      id: `svi-setting-${key}`,
      label: T(`Settings.${key}.Name`),
      hint: T(`Settings.${key}.Hint`),
      value: getSetting(key),
      fallback: registeredDefault(key),
    }));
  }

  #themeFamilies() {
    const saved = normalizeTheme(getSetting(SETTINGS.theme));
    const shown = ThemeApplier.current();
    const families = THEME_FAMILIES.map((family) => ({
      label: T(`ThemeFamily.${family.id}`),
      themes: family.themes.map((id) => ({ id, label: T(`Theme.${id}`), current: id === saved, selected: id === shown })),
    }));
    if (isLegacyTheme(saved)) families.push({
      label: T("ThemeFamily.Legacy"),
      themes: [{ id: saved, label: T(`Theme.${saved}`), current: true, selected: saved === shown }],
    });
    return families;
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
        event: isEventPhase(phase),
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
        icons: PHASE_ICONS.map((cls) => ({ cls, label: localize(T(`Config.Phases.Icons.${iconName(cls)}`)), selected: cls === phase.icon })),
        colors: PHASE_COLORS.map((hex) => ({ hex, label: localize(T(`Config.Phases.Colors.${PHASE_COLOR_NAMES[hex]}`)), selected: hex.toLowerCase() === phase.color.toLowerCase() })),
        sound: this.#soundContext(phase, name),
        actions: this.#actionsContext(phase),
      };
    });
  }

  /** The sound of one phase when it starts, ready for the template. */
  #soundContext(phase, name) {
    const sound = phaseSound(phase);
    return {
      ...sound,
      custom: sound.mode === SOUND_MODES.custom,
      label: game.i18n.format(T("Config.Phases.Sound.Label"), { name }),
      modes: Object.values(SOUND_MODES).map((mode) => ({ value: mode, label: T(`Config.Phases.Sound.Modes.${mode}`), selected: mode === sound.mode })),
    };
  }

  /** The SC Jump Scare library as options, through the module's own API; empty without the module. */
  static #scares() {
    const api = game.modules.get("sc-jump-scare")?.active ? game.modules.get("sc-jump-scare").api : null;
    return (api?.choices?.() ?? []).map((scare) => ({ value: scare.id, label: scare.name }));
  }

  /** The world's puzzles: the journal pages of the SC Puzzle Engine's type, named with their journal. */
  static #puzzles() {
    const puzzles = [];
    for (const journal of game.journal ?? []) {
      for (const page of journal.pages ?? []) {
        if (page.type === PUZZLE_PAGE_TYPE) puzzles.push({ value: page.uuid, label: `${journal.name} — ${page.name}` });
      }
    }
    return puzzles.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** A saved choice that is no longer listed stays in the select, named as missing, so opening the screen never drops it. */
  static #pickOptions(choices, value) {
    const options = choices.map((choice) => ({ ...choice, selected: choice.value === value }));
    if (value && !options.some((o) => o.selected)) options.push({ value, label: game.i18n.format(T("Automation.MissingChoice"), { id: value }), selected: true });
    return options;
  }

  /** The "actions when it starts" of one phase, ready for the template. */
  #actionsContext(phase) {
    const rows = phase.onEnter ?? [];
    const localize = (key) => game.i18n.localize(key);
    const macros = [...(game.macros ?? [])].map((m) => ({ value: m.uuid, label: m.name }));
    const picks = { scare: PhaseConfigApp.#scares(), puzzle: PhaseConfigApp.#puzzles(), banner: this.#bannerChoices() };
    const pickEmpty = { scare: T("Automation.NoScare"), puzzle: T("Automation.NoPuzzle") };
    return {
      open: this.#openActions.has(phase.id),
      count: rows.length,
      countLabel: rows.length === 1 ? T("Automation.CountOne") : game.i18n.format(T("Automation.CountMany"), { count: rows.length }),
      kinds: CONSEQUENCE_KIND_IDS.map((id) => {
        const required = CONSEQUENCE_KINDS[id].requires;
        const missing = required && !game.modules.get(required)?.active;
        return { id, label: T(`Automation.Kinds.${id}`), disabled: !!missing, title: missing ? game.i18n.format(T("Automation.Requires"), { module: required }) : "" };
      }),
      rows: rows.map((row, index) => {
        const kind = CONSEQUENCE_KINDS[row.kind];
        return {
          id: row.id,
          kind: row.kind,
          icon: kind?.icon ?? "fa-solid fa-circle-question",
          label: T(`Automation.Kinds.${row.kind}`),
          where: T(kind?.where === "gm" ? "Automation.Gm" : "Automation.Local"),
          enabled: row.enabled !== false,
          canPreview: row.kind === "screenMessage",
          canUp: index > 0,
          canDown: index < rows.length - 1,
          fields: (kind?.fields ?? []).map((field) => {
            const value = row.params?.[field.name] ?? field.default;
            return {
              name: field.name,
              label: T(`Automation.Fields.${field.name}`),
              value,
              isText: field.type === "text",
              isTextarea: field.type === "textarea",
              isNumber: field.type === "number",
              isSelect: field.type === "select",
              isMacro: field.type === "macro",
              isFile: field.type === "file",
              isUuid: field.type === "uuid",
              isPick: field.type in picks,
              picks: field.type in picks ? PhaseConfigApp.#pickOptions(picks[field.type], value) : [],
              pickEmpty: pickEmpty[field.type] ?? null,
              min: field.min,
              max: field.max,
              choices: (field.choices ?? []).map((c) => ({ value: c, label: localize(T(`Automation.Choices.${c}`)), selected: c === value })),
              macros: field.type === "macro" ? macros.map((m) => ({ ...m, selected: m.value === value })) : [],
            };
          }),
        };
      }),
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Tabs, fields and the unsaved state                                */
  /* ------------------------------------------------------------------ */

  #showTab(tabId) {
    if (!this.#tabs().some((tab) => tab.id === tabId)) return;
    this.#activeTab = tabId;
    for (const button of this.element?.querySelectorAll(".svi-config-tab") ?? []) {
      const active = button.dataset.tab === tabId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    }
    for (const panel of this.element?.querySelectorAll("[data-tab-panel]") ?? []) panel.hidden = panel.dataset.tabPanel !== tabId;
  }

  #onRailKey(event) {
    const tab = event.target.closest?.(".svi-config-tab");
    if (!tab) return;
    const buttons = [...this.element.querySelectorAll(".svi-config-tab")];
    const index = buttons.indexOf(tab);
    const target = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    const next = buttons[(target + buttons.length) % buttons.length];
    this.#showTab(next.dataset.tab);
    next.focus();
  }

  static #fieldValue(field) {
    if (field.type === "checkbox") return field.checked;
    if (field.type === "radio") return field.checked ? field.value : undefined;
    return field.value;
  }

  /** The values on screen, one per setting key (a radio group gives its checked value). */
  #fieldValues() {
    const values = new Map();
    for (const field of this.element?.querySelectorAll(SETTING_FIELD) ?? []) {
      const value = PhaseConfigApp.#fieldValue(field);
      if (value !== undefined) values.set(field.dataset.setting, value);
    }
    return values;
  }

  #captureBaseline() {
    this.#baseline = this.#fieldValues();
  }

  #dirtyTabs() {
    const dirty = new Set();
    for (const [key, value] of this.#fieldValues()) {
      if (this.#baseline.get(key) !== value) dirty.add(schemaEntry(key)?.tab);
    }
    if (this.#phasesDirty) dirty.add("phases");
    if (this.#bannersDirty) dirty.add("banners");
    return dirty;
  }

  /** The pill and the dot of every tab with unsaved changes. */
  #refreshState({ saved = false } = {}) {
    if (!this.element) return;
    const dirty = this.#dirtyTabs();
    for (const button of this.element.querySelectorAll(".svi-config-tab")) {
      const changed = dirty.has(button.dataset.tab);
      button.classList.toggle("svi-dirty", changed);
      const label = game.i18n.localize(T(`Config.Tabs.${button.dataset.tab}`));
      button.setAttribute("aria-label", changed ? game.i18n.format(T("Config.UnsavedTab"), { tab: label }) : label);
    }
    const pill = this.element.querySelector(".svi-status-pill");
    if (!pill) return;
    pill.hidden = !dirty.size && !saved;
    pill.classList.toggle("svi-dirty", dirty.size > 0);
    pill.querySelector(".svi-status-label")?.replaceChildren(game.i18n.localize(T(dirty.size ? "Config.Unsaved" : "Config.SavedPill")));
  }

  #onFieldChange(event) {
    const field = event.target;
    if (field.matches?.("select.svi-add-action")) return this.#addAction(field);
    if (field.dataset?.actionField) return this.#editAction(field);
    if (field.dataset?.soundField) return this.#editSound(field);
    if (field.dataset?.bannerField) return this.#editBanner(field, { committed: true });
    if (field.dataset?.setting === SETTINGS.theme) this.#previewTheme(field.value);
    if (field.dataset?.customColor) this.#previewCustomColors();
    this.#refreshState();
    return undefined;
  }

  /** The custom colors on screen, previewed on this client while they differ from the saved ones; back at the saved ones, the preview ends. */
  #previewCustomColors() {
    const read = (key) => this.element.querySelector(`[data-setting="${key}"]`)?.value;
    const colors = { accent: read(SETTINGS.customAccent), background: read(SETTINGS.customBackground), text: read(SETTINGS.customText) };
    const saved = customThemeColors();
    ThemeApplier.previewColors(Object.keys(saved).some((name) => colors[name] !== saved[name]) ? colors : null);
  }

  #previewTheme(theme) {
    if (theme === normalizeTheme(getSetting(SETTINGS.theme))) ThemeApplier.endPreview();
    else ThemeApplier.preview(theme);
    this.#previewCustomColors();
    const note = this.element.querySelector(".svi-preview-note");
    if (!note) return;
    note.hidden = !ThemeApplier.previewing;
    note.querySelector(".svi-preview-note-label")?.replaceChildren(
      game.i18n.format(T("Config.Appearance.Previewing"), {
        theme: game.i18n.localize(T(`Theme.${ThemeApplier.current()}`)),
        saved: game.i18n.localize(T(`Theme.${normalizeTheme(getSetting(SETTINGS.theme))}`)),
      }),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Phase draft                                                       */
  /* ------------------------------------------------------------------ */

  #changePlan(next, { focus = null } = {}) {
    this.#plan = next;
    this.#phasesDirty = true;
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
    this.#phasesDirty = true;
    if (this.#errors.delete(id)) {
      this.#focus = `[data-id="${id}"] input.svi-phase-name-input`;
      this.render({ parts: ["phases"] });
    } else this.#refreshState();
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

  static async #confirm(title, body, confirmLabel) {
    return foundry.applications.api.DialogV2.confirm({
      classes: [MODULE_ID, "svi-dialog"],
      render: (event, dialog) => ThemeApplier.apply(dialog.element),
      window: { title },
      content: `<p>${body}</p>`,
      yes: { label: confirmLabel, icon: "fa-solid fa-check" },
      no: { label: T("Config.Phases.Cancel"), icon: "fa-solid fa-xmark", default: true },
      rejectClose: false,
    });
  }

  /** Changes one phase's action list in the draft. */
  #updateActions(phaseId, change, { render = true } = {}) {
    this.#plan = this.#plan.map((p) => (p.id === phaseId ? { ...p, onEnter: change([...(p.onEnter ?? [])]) } : p));
    this.#phasesDirty = true;
    if (render) this.#changePlan(this.#plan);
    else this.#refreshState();
  }

  #addAction(select) {
    const phaseId = select.closest("[data-id]").dataset.id;
    const row = normalizeConsequence({ kind: select.value }, () => foundry.utils.randomID(10));
    select.value = "";
    if (!row) return;
    this.#openActions.add(phaseId);
    this.#updateActions(phaseId, (rows) => [...rows, row]);
  }

  /** A field or the on/off box of one action; the draft changes without a render. */
  #editAction(field) {
    const phaseId = field.closest("[data-id]").dataset.id;
    const rowId = field.closest("[data-action-id]").dataset.actionId;
    const name = field.dataset.actionField;
    const value = field.type === "checkbox" ? field.checked : field.value;
    this.#updateActions(phaseId, (rows) => rows.map((row) => {
      if (row.id !== rowId) return row;
      if (name === "enabled") return { ...row, enabled: value };
      return normalizeConsequence({ ...row, params: { ...row.params, [name]: value } }) ?? row;
    }), { render: false });
  }

  /* ------------------------------------------------------------------ */
  /*  Banner themes                                                     */
  /* ------------------------------------------------------------------ */

  /** Every banner theme a message can use: the ready-made ones, then the GM's own. */
  #bannerChoices() {
    const ready = BANNER_STYLES.map((id) => ({ value: id, label: game.i18n.localize(T(`Automation.Choices.${id}`)) }));
    return [...ready, ...(this.#banners ?? []).map((theme) => ({ value: theme.id, label: theme.name || game.i18n.localize(T("Config.Banners.Unnamed")) }))];
  }

  static #bannerStyle(theme) {
    return Object.entries(bannerVariables(theme)).map(([name, value]) => `${name}: ${value}`).join("; ");
  }

  /** The Banners tab: the ready-made themes as samples, and the GM's own with their fields. */
  #bannerContext() {
    const localize = (key) => game.i18n.localize(key);
    return {
      ready: BANNER_STYLES.map((id) => ({ id, name: localize(T(`Automation.Choices.${id}`)) })),
      mine: this.#banners.map((theme) => ({
        ...theme,
        style: PhaseConfigApp.#bannerStyle(theme),
        colors: BANNER_COLOR_FIELDS.map((field) => ({ field, label: T(`Config.Banners.Fields.${field}`), value: theme[field] })),
      })),
    };
  }

  /** A field of one of the GM's banner themes: the draft and its sample follow; a new name also reaches the Phases tab. */
  #editBanner(field, { committed = false } = {}) {
    const card = field.closest("[data-banner-id]");
    const name = field.dataset.bannerField;
    const value = field.type === "checkbox" ? field.checked : field.value;
    this.#banners = normalizeBannerThemes(this.#banners.map((theme) => (theme.id === card.dataset.bannerId ? { ...theme, [name]: value } : theme)));
    this.#bannersDirty = true;
    const theme = this.#banners.find((t) => t.id === card.dataset.bannerId);
    const sample = card.querySelector(".svi-banner");
    if (theme && sample) {
      for (const [variable, color] of Object.entries(bannerVariables(theme))) sample.style.setProperty(variable, color);
      if (name === "name") sample.querySelector(".svi-banner-title")?.replaceChildren(theme.name || game.i18n.localize(T("Config.Banners.Unnamed")));
    }
    if (committed && name === "name") this.render({ parts: ["phases"] });
    this.#refreshState();
  }

  #changeBanners(next, { focus = null } = {}) {
    this.#banners = normalizeBannerThemes(next);
    this.#bannersDirty = true;
    this.#focus = focus;
    this.render({ parts: ["banners", "phases"] });
  }

  /** A new theme of the GM's own, from the module's colors. */
  static #onAddBanner() {
    const id = `banner-${foundry.utils.randomID(8)}`;
    const theme = copyBannerTheme(BANNER_PRESETS.themed, { id, name: game.i18n.localize(T("Config.Banners.NewName")) });
    this.#changeBanners([...this.#banners, theme], { focus: `[data-banner-id="${id}"] input[data-banner-field="name"]` });
  }

  /** Saves the phases or the banner themes on screen, unsaved changes included, as a JSON file. */
  static #onExport(event, target) {
    const kind = target.dataset.kind;
    const data = kind === TRANSFER_KINDS.banners ? this.#banners : this.#plan;
    foundry.utils.saveDataToFile(exportPayload(kind, data), "application/json", exportFileName(kind));
  }

  /** Reads a file exported here into the draft: phases replace the list, banner themes join the GM's own. Nothing is saved yet. */
  static #onImport(event, target) {
    const kind = target.dataset.kind;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = parseImport(await file.text(), kind);
      if (result.error) return void ui.notifications.error(game.i18n.localize(T(`Config.Transfer.Errors.${result.error}`)));
      if (kind === TRANSFER_KINDS.banners) this.#changeBanners(mergeBannerThemes(this.#banners, result.data));
      else this.#changePlan(result.data);
      ui.notifications.info(game.i18n.format(T("Config.Transfer.Imported"), { count: result.data.length }));
    });
    input.click();
  }

  /** A new theme of the GM's own, starting as a copy of a ready-made one or of another of theirs. */
  static #onCopyBanner(event, target) {
    const sourceId = target.dataset.bannerSource;
    const own = this.#banners.find((theme) => theme.id === sourceId);
    const sourceName = own ? own.name : game.i18n.localize(T(`Automation.Choices.${sourceId}`));
    const id = `banner-${foundry.utils.randomID(8)}`;
    const copy = copyBannerTheme(own ?? BANNER_PRESETS[sourceId], { id, name: game.i18n.format(T("Config.Banners.CopyName"), { name: sourceName }) });
    this.#changeBanners([...this.#banners, copy], { focus: `[data-banner-id="${id}"] input[data-banner-field="name"]` });
  }

  static #onDeleteBanner(event, target) {
    const id = target.closest("[data-banner-id]").dataset.bannerId;
    this.#changeBanners(this.#banners.filter((theme) => theme.id !== id));
  }

  /** Shows a banner theme on this client, as it is in the draft. */
  static #onPreviewBanner(event, target) {
    const style = target.dataset.bannerSource;
    const own = this.#banners.find((theme) => theme.id === style);
    PhaseBanner.show({
      title: own ? own.name || game.i18n.localize(T("Config.Banners.Unnamed")) : game.i18n.localize(T(`Automation.Choices.${style}`)),
      text: game.i18n.localize(T("Config.Banners.SampleText")),
      style,
      seconds: 4,
      themes: this.#banners,
    });
  }

  /** The sound of a phase; only another choice of sound changes what the row shows. */
  #editSound(field) {
    const phaseId = field.closest("[data-id]").dataset.id;
    const name = field.dataset.soundField;
    const next = setPhaseSound(this.#plan, phaseId, { [name]: field.value });
    if (name === "mode") return this.#changePlan(next, { focus: `[data-id="${phaseId}"] [data-sound-field="mode"]` });
    this.#plan = next;
    this.#phasesDirty = true;
    return this.#refreshState();
  }

  static #onPreviewSound(event, target) {
    const sound = phaseSound(phaseById(this.#plan, target.closest("[data-id]").dataset.id));
    if (sound.src) foundry.audio.AudioHelper.play({ src: sound.src, volume: sound.volume / 100, loop: false }, false);
  }

  /** A document dropped on a UUID field (roll table, puzzle page, actor). */
  #onDropUuid(event, input) {
    event.preventDefault();
    const TextEditor = foundry.applications.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    const data = TextEditor?.getDragEventData?.(event);
    if (!data?.uuid) return;
    input.value = data.uuid;
    this.#editAction(input);
  }

  /* ------------------------------------------------------------------ */
  /*  Actions                                                           */
  /* ------------------------------------------------------------------ */

  static #onTab(event, target) {
    this.#showTab(target.dataset.tab);
  }

  /** The active tab back to the registered defaults, unsaved; on Phases, the default phases after a confirmation. */
  static async #onResetTab() {
    const tab = this.#activeTab;
    if (tab === "banners") {
      if (!this.#banners.length) return;
      const ok = await PhaseConfigApp.#confirm(T("Config.Banners.ResetTitle"), game.i18n.localize(T("Config.Banners.ResetBody")), T("Config.Banners.ResetConfirm"));
      if (ok) this.#changeBanners([]);
      return;
    }
    if (tab === "phases") {
      const ok = await PhaseConfigApp.#confirm(T("Config.Phases.RestoreTitle"), game.i18n.localize(T("Config.Phases.RestoreBody")), T("Config.Phases.RestoreConfirm"));
      if (ok) this.#changePlan(defaultPlan());
      return;
    }
    const panel = this.element.querySelector(`[data-tab-panel="${tab}"]`);
    for (const field of panel?.querySelectorAll(SETTING_FIELD) ?? []) {
      const fallback = field.dataset.default;
      if (field.type === "checkbox") field.checked = fallback === "true";
      else if (field.type === "radio") field.checked = field.value === fallback;
      else field.value = fallback;
      if (field.dataset.setting === SETTINGS.theme && (field.type !== "radio" || field.checked)) this.#previewTheme(field.value);
    }
    if (tab === "appearance") this.#previewCustomColors();
    this.#refreshState();
  }

  static #onClose() {
    this.close();
  }

  /** Writes only what changed; a phase without a name stops the save before anything is written. */
  static async #onSave() {
    const missing = this.#phasesDirty ? phasesWithoutName(this.#plan) : [];
    if (missing.length) {
      this.#errors = new Set(missing);
      this.#focus = `[data-id="${missing[0]}"] input.svi-phase-name-input`;
      this.#showTab("phases");
      this.render({ parts: ["phases"] });
      return;
    }
    for (const [key, raw] of this.#fieldValues()) {
      const entry = schemaEntry(key);
      if (!entry || (entry.scope === "world" && !game.user.isGM)) continue;
      const value = coerceSetting(entry, raw);
      if (value !== getSetting(key)) await setSetting(key, value);
    }
    if (this.#phasesDirty && game.user.isGM) {
      this.#plan = this.#plan.map((p) => {
        const next = typeof p.name === "string" ? { ...p, name: p.name.trim() } : { ...p };
        if (next.onEnter) next.onEnter = normalizeConsequences(next.onEnter);
        return next;
      });
      await setSetting(SETTINGS.phaseTemplate, this.#plan);
      this.#phasesDirty = false;
      this.render({ parts: ["phases"] });
    }
    if (this.#bannersDirty && game.user.isGM) {
      await setSetting(SETTINGS.bannerThemes, this.#banners);
      this.#bannersDirty = false;
    }
    // The preview is the saved theme now.
    ThemeApplier.endPreview();
    this.element.querySelector(".svi-preview-note")?.setAttribute("hidden", "");
    this.#captureBaseline();
    this.#refreshState({ saved: true });
    ui.notifications.info(game.i18n.localize(T("Config.Saved")));
  }

  static #onAddPhase() {
    this.#appendPhase({ event: false });
  }

  static #onAddEventPhase() {
    this.#appendPhase({ event: true });
  }

  #appendPhase({ event }) {
    const ids = new Set(this.#plan.map((p) => p.id));
    let id;
    do id = foundry.utils.randomID(8);
    while (ids.has(id));
    this.#changePlan(addPhase(this.#plan, () => id, { event }), { focus: `[data-id="${id}"] input.svi-phase-name-input` });
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

  static #onMoveAction(event, target) {
    const phaseId = target.closest("[data-id]").dataset.id;
    const rowId = target.closest("[data-action-id]").dataset.actionId;
    const step = Number(target.dataset.step);
    this.#focus = `[data-action-id="${rowId}"] [data-action="moveAction"][data-step="${step}"]`;
    this.#updateActions(phaseId, (rows) => {
      const from = rows.findIndex((row) => row.id === rowId);
      const to = from + step;
      if (from === -1 || to < 0 || to >= rows.length) return rows;
      [rows[from], rows[to]] = [rows[to], rows[from]];
      return rows;
    });
  }

  /** Shows a message on screen as it is in the draft, on this client only. */
  static #onPreviewMessage(event, target) {
    const phase = phaseById(this.#plan, target.closest("[data-id]").dataset.id);
    const row = (phase?.onEnter ?? []).find((r) => r.id === target.closest("[data-action-id]").dataset.actionId);
    if (!row) return;
    const title = displayName(phase, (key) => game.i18n.localize(key));
    const text = row.params.text;
    PhaseBanner.show({ title, text, icon: phase.icon, color: phase.color, style: row.params.style, seconds: 4, themes: this.#banners });
  }

  static async #onDeleteAction(event, target) {
    const phaseId = target.closest("[data-id]").dataset.id;
    const rowId = target.closest("[data-action-id]").dataset.actionId;
    const phase = foundry.utils.escapeHTML(displayName(phaseById(this.#plan, phaseId), (key) => game.i18n.localize(key)));
    const ok = await PhaseConfigApp.#confirm(T("Automation.DeleteTitle"), game.i18n.format(T("Automation.DeleteBody"), { phase }), T("Config.Phases.DeleteConfirm"));
    if (ok) this.#updateActions(phaseId, (rows) => rows.filter((row) => row.id !== rowId));
  }

  static #onPickFile(event, target) {
    const input = target.closest(".svi-file-field")?.querySelector("input");
    const FilePicker = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!input || !FilePicker) return;
    new FilePicker({
      type: "audio",
      current: input.value,
      callback: (path) => {
        input.value = path;
        if (input.dataset.soundField) this.#editSound(input);
        else this.#editAction(input);
      },
    }).render({ force: true });
  }
}
