import { I18N_ROOT, MODULE_ID, OPERATION_KEY, SETTINGS } from "./constants/module-constants.js";
import { backTarget } from "./helpers/phase-progression.js";
import { registerKeybindings } from "./hooks/register-keybindings.js";
import { getSetting, naturalRules, registerSettings, rollPrompt, rollPromptView, rollSettings, suggestFromSheet } from "./hooks/register-settings.js";
import ActorPhaseDialog from "./applications/ActorPhaseDialog.js";
import PhaseConfigApp from "./applications/PhaseConfigApp.js";
import PhasedCombatTracker from "./applications/PhasedCombatTracker.js";
import AutoAdvanceWatcher from "./services/AutoAdvanceWatcher.js";
import CombatSetup from "./services/CombatSetup.js";
import CommunityLinks from "./services/CommunityLinks.js";
import CombatSnapshot from "./services/CombatSnapshot.js";
import CombatSorter from "./services/CombatSorter.js";
import CombatStartGuard from "./services/CombatStartGuard.js";
import CombatWatcher from "./services/CombatWatcher.js";
import CombatantClassifier from "./services/CombatantClassifier.js";
import DcSuggester from "./services/DcSuggester.js";
import DoneMarkers from "./services/DoneMarkers.js";
import ErrorGuard from "./services/ErrorGuard.js";
import EventMarkers from "./services/EventMarkers.js";
import GmBusyProbe from "./services/GmBusyProbe.js";
import GmCommands from "./services/GmCommands.js";
import InitiativeRoller from "./services/InitiativeRoller.js";
import IntegrationHooks from "./services/IntegrationHooks.js";
import ModuleConflictAdvisor from "./services/ModuleConflictAdvisor.js";
import NaturalRollRecorder from "./services/NaturalRollRecorder.js";
import PhaseAdvancer from "./services/PhaseAdvancer.js";
import PhaseAutomationRunner from "./services/PhaseAutomationRunner.js";
import PhasePlacementWriter from "./services/PhasePlacementWriter.js";
import PhaseSoundGuard from "./services/PhaseSoundGuard.js";
import PhaseTurnMarkers from "./services/PhaseTurnMarkers.js";
import RollPrompter from "./services/RollPrompter.js";
import ThemeApplier from "./services/ThemeApplier.js";
import TurnInterceptor from "./services/TurnInterceptor.js";
import AdapterFactory from "./services/adapters/AdapterFactory.js";

/**
 * Wiring only. The adapter is chosen at `init` (the system is known by then)
 * and shared by every service; every hook goes through ErrorGuard.
 */
const services = {};

function build(adapter) {
  const commands = new GmCommands();
  const writer = new PhasePlacementWriter({ adapter, advance: (combat, options) => advancer.advance(combat, options) });
  const advancer = new PhaseAdvancer({ adapter, writer });
  const doneMarkers = new DoneMarkers({ adapter });
  const classifier = new CombatantClassifier({ adapter, writer, naturals: naturalRules, suggestFromSheet });
  const dcSuggester = new DcSuggester({ adapter, classifier, base: () => getSetting(SETTINGS.dcBase) });
  const naturals = new NaturalRollRecorder({ adapter });
  const setup = new CombatSetup();
  const probe = new GmBusyProbe({ onChange: () => view.render() });
  const watcher = new AutoAdvanceWatcher({ adapter, advancer, probe });
  const interceptor = new TurnInterceptor({ adapter, commands, doneMarkers });
  const roller = new InitiativeRoller({ adapter, settings: rollSettings });
  const prompter = new RollPrompter({ roller, enabled: rollPrompt, view: rollPromptView });
  const startGuard = new CombatStartGuard({ adapter, roller });
  const automation = new PhaseAutomationRunner({ adapter });
  const soundGuard = new PhaseSoundGuard({ adapter });
  const integration = new IntegrationHooks({ adapter });
  const markers = new EventMarkers();
  const turnMarkers = new PhaseTurnMarkers({ adapter, enabled: () => getSetting(SETTINGS.phaseTurnMarkers) });
  const tracker = { adapter, commands, doneMarkers, probe, roller, openHelp: () => PhaseConfigApp.open("help") };
  const view = new CombatWatcher({ patchDone: (ids) => PhasedCombatTracker.patchDone(ids) });

  const refuseBack = (combat) => (backTarget(CombatSnapshot.from(combat, adapter)).refuse ? "NoEarlierPhase" : null);
  commands.register("advance", (combat, { force = true } = {}) => advancer.advance(combat, { force }));
  commands.register("complete", (combat) => advancer.complete(combat));
  commands.register("back", (combat) => advancer.back(combat), { precheck: refuseBack });
  commands.register("toggle", (combat, payload) => setup.toggle(combat, payload));
  commands.register("setDc", (combat, payload) => classifier.setDc(combat, { value: payload?.value }));
  commands.register("recalculateDc", (combat) => dcSuggester.recalculate(combat));
  commands.register("assign", (combat, payload) => classifier.assign(combat, payload));
  commands.register("addMarker", (combat, payload) => markers.add(combat, payload));

  Object.assign(services, { adapter, roller, prompter, turnMarkers, commands, doneMarkers, advancer, classifier, dcSuggester, naturals, setup, probe, watcher, interceptor, startGuard, view, tracker, automation, soundGuard, integration });
}

/** The keybinding actions: each answers whether it acted, so an unused key reaches other bindings. */
function keybindingActions() {
  const running = () => {
    const combat = game.combat;
    return combat?.started && CombatSnapshot.isPhased(combat) ? combat : null;
  };
  // The work is not awaited: the key answers at once, and ErrorGuard reports a failure later.
  const when = (label, act) => {
    const guarded = ErrorGuard.wrap(`key:${label}`, act);
    return () => {
      const combat = running();
      if (!combat) return false;
      guarded(combat);
      return true;
    };
  };
  return {
    markOwnDone: when("markOwnDone", (combat) => services.doneMarkers.markOwn(combat)),
    advancePhase: when("advancePhase", (combat) => services.commands.execute("advance", combat, { force: true })),
    previousPhase: when("previousPhase", (combat) => services.commands.execute("back", combat)),
    showTracker: () => {
      ErrorGuard.wrap("key:showTracker", () => services.view.show())();
      return true;
    },
  };
}

Hooks.once("init", () => {
  const adapter = AdapterFactory.create(game.system.id);
  registerSettings({
    onViewChange: () => services.view?.render(),
    onThemeChange: () => {
      ThemeApplier.refresh();
      services.view?.render();
    },
    onMarkersChange: () => services.turnMarkers?.refresh(),
    SettingsMenu: PhaseConfigApp,
    defaults: adapter.settingDefaults(),
  });
  build(adapter);
  PhaseConfigApp.defaultFormula = () => adapter.defaultFormula();
  registerKeybindings(keybindingActions());
  CombatSorter.install();
  // Registered at init so the turn order is fixed before any other module's listener runs.
  ErrorGuard.on("updateCombat", "sort", (combat, changed) => CombatSorter.onUpdateCombat(combat, changed));
});

Hooks.once("setup", () => {
  services.startGuard.install();
  services.soundGuard.install();
  // The system's document classes are final by now.
  services.adapter.guardEventMarkers((combatant) => CombatSnapshot.isEventMarker(combatant));
  services.turnMarkers.install();
  services.interceptor.install();
  // After every init (the system set its tracker class) and before the UI is built.
  PhasedCombatTracker.install(services.tracker);
});

Hooks.once("ready", () => {
  const { commands, advancer, classifier, dcSuggester, naturals, setup, probe, watcher, interceptor, startGuard, view, automation, integration, prompter } = services;
  startGuard.check();
  // The custom theme's palette is a rule of the module's own, written once the settings can be read.
  ThemeApplier.refresh();
  PhasedCombatTracker.check();
  commands.relay.start();
  game.modules.get(MODULE_ID).api = {
    open: () => view.open(),
    close: () => view.close(),
    toggle: () => view.toggle(),
    openSettings: (tab) => PhaseConfigApp.open(tab),
  };

  // Combat rules: the active GM writes, the requesting client intercepts.
  ErrorGuard.on("createCombat", "setup", (combat) => setup.onCreateCombat(combat));
  ErrorGuard.on("preUpdateCombat", "intercept", (combat, changes, options) => interceptor.onPreUpdateCombat(combat, changes, options));
  ErrorGuard.on("preDeleteCombatant", "intercept", (combatant, options) => interceptor.onPreDeleteCombatant(combatant, options));
  ErrorGuard.on("updateCombat", "combat", (combat, changed, options) => {
    if (!game.user.isActiveGM) return undefined;
    // The native start (round 0 to 1); the module's own writes after it are watched as usual.
    const started = combat.round === 1 && combat.previous?.round === 0 && !options?.[OPERATION_KEY];
    dcSuggester.onUpdateCombat(combat, changed);
    return Promise.all([
      classifier.onUpdateCombat(combat, changed, options),
      started ? advancer.afterNativeStart(combat) : watcher.onUpdateCombat(combat, changed, options),
    ]);
  });
  ErrorGuard.on("createCombatant", "combatant", (combatant, options) => {
    classifier.onCreateCombatant(combatant);
    watcher.onCreateCombatant(combatant, options);
    dcSuggester.onCombatantChange(combatant);
  });
  ErrorGuard.on("updateCombatant", "combatant", (combatant, changes, options) => {
    classifier.onUpdateCombatant(combatant, changes, options);
    watcher.onUpdateCombatant(combatant, changes, options);
    dcSuggester.onCombatantChange(combatant);
  });
  ErrorGuard.on("deleteCombatant", "combatant", (combatant, options) => {
    watcher.onDeleteCombatant(combatant, options);
    dcSuggester.onCombatantChange(combatant);
  });
  // The natural d20 of an initiative roll, on the client that rolled it.
  ErrorGuard.on("createChatMessage", "natural", (message) => naturals.onCreateChatMessage(message));
  for (const hook of ["createActiveEffect", "deleteActiveEffect"]) {
    ErrorGuard.on(hook, "defeat", (effect) => watcher.onActiveEffect(effect));
  }
  ErrorGuard.on("updateActiveEffect", "defeat", (effect, changes) => watcher.onActiveEffect(effect, changes));
  ErrorGuard.on("userConnected", "active-gm", () => watcher.onUserConnected());
  ErrorGuard.on("closeApplicationV2", "busy", () => probe.poke());
  ErrorGuard.on("closeDialog", "busy", () => probe.poke());

  // The combat tracker, on every client: the core renders it; the module shows it and patches done marks.
  ErrorGuard.on("updateCombat", "view", (combat) => view.onUpdateCombat(combat));
  // A phase's actions when it starts, on every client: GM actions on the active GM, local ones where the phase is seen.
  ErrorGuard.on("updateCombat", "automation", (combat, changed, options) => automation.onUpdateCombat(combat, changed, options));
  ErrorGuard.on("updateCombatant", "view", (combatant, changes) => view.onUpdateCombatant(combatant, changes));
  // The module's own hooks for other modules, on every client; and on GM clients, conflicting settings at the start.
  ErrorGuard.on("updateCombat", "integration", (combat, changed, options) => integration.onUpdateCombat(combat, changed, options));
  ErrorGuard.on("updateCombatant", "integration", (combatant, changes) => integration.onUpdateCombatant(combatant, changes));
  // "Combat phase" on a creature's sheet: the "…" menu of V2 sheets, a header button on V1 sheets.
  ErrorGuard.on("getHeaderControlsActorSheetV2", "actor-phase", (app, controls) => ActorPhaseDialog.addHeaderControl(app, controls));
  ErrorGuard.on("getActorSheetHeaderButtons", "actor-phase", (app, buttons) => ActorPhaseDialog.addHeaderButton(app, buttons));
  // Turn markers under every member still acting, on every client: any change of the viewed combat redraws them.
  const redrawMarkers = (combat) => {
    if (combat === game.combat) services.turnMarkers.scheduleRefresh();
  };
  ErrorGuard.on("updateCombat", "turn-markers", (combat) => redrawMarkers(combat));
  for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant"]) {
    ErrorGuard.on(hook, "turn-markers", (combatant) => redrawMarkers(combatant.parent));
  }
  ErrorGuard.on("updateToken", "turn-markers", (_token, changed) => {
    if (Object.hasOwn(changed, "hidden")) services.turnMarkers.scheduleRefresh();
  });
  // A player with a character in the combat and no roll is asked to roll.
  ErrorGuard.on("createCombatant", "roll-prompt", (combatant) => prompter.onCreateCombatant(combatant));
  ErrorGuard.on("updateCombat", "roll-prompt", (combat, changed) => prompter.onUpdateCombat(combat, changed));
  ErrorGuard.on("updateCombat", "conflicts", (combat, changed, options) => ModuleConflictAdvisor.onUpdateCombat(combat, changed, options));

  // Wiki, Patreon and Discord, at the end of the module's section in Foundry's settings window.
  ErrorGuard.on("renderSettingsConfig", "community-links", (_app, html) => CommunityLinks.inject(html));

  if (game.user.isActiveGM) watcher.reviewAll();
  if (game.user.isGM && services.adapter.experimental) ui.notifications.warn(game.i18n.localize(`${I18N_ROOT}.Roll.Experimental`));
  view.openIfRunning();
  prompter.queue(game.combat);
});
