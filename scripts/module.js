import { MODULE_ID, OPERATION_KEY } from "./constants/module-constants.js";
import { backTarget } from "./helpers/phase-progression.js";
import { registerSettings } from "./hooks/register-settings.js";
import PhaseConfigApp from "./applications/PhaseConfigApp.js";
import PhaseTrackerApp from "./applications/PhaseTrackerApp.js";
import AutoAdvanceWatcher from "./services/AutoAdvanceWatcher.js";
import CombatSetup from "./services/CombatSetup.js";
import CombatSnapshot from "./services/CombatSnapshot.js";
import CombatSorter from "./services/CombatSorter.js";
import CombatStartGuard from "./services/CombatStartGuard.js";
import CombatWatcher from "./services/CombatWatcher.js";
import CombatantClassifier from "./services/CombatantClassifier.js";
import DoneMarkers from "./services/DoneMarkers.js";
import ErrorGuard from "./services/ErrorGuard.js";
import GmBusyProbe from "./services/GmBusyProbe.js";
import GmCommands from "./services/GmCommands.js";
import NativeTrackerDecorator from "./services/NativeTrackerDecorator.js";
import PhaseAdvancer from "./services/PhaseAdvancer.js";
import PhasePlacementWriter from "./services/PhasePlacementWriter.js";
import TurnInterceptor from "./services/TurnInterceptor.js";
import AdapterFactory from "./services/adapters/AdapterFactory.js";

/**
 * Wiring only. The adapter is chosen at `init` (the system is known by then)
 * and shared by every service; every hook goes through ErrorGuard.
 */
const services = {};

function build() {
  const adapter = AdapterFactory.create(game.system.id);
  const commands = new GmCommands();
  const writer = new PhasePlacementWriter({ adapter, advance: (combat, options) => advancer.advance(combat, options) });
  const advancer = new PhaseAdvancer({ adapter, writer });
  const doneMarkers = new DoneMarkers({ adapter });
  const classifier = new CombatantClassifier({ adapter, writer });
  const setup = new CombatSetup();
  const probe = new GmBusyProbe({ onChange: () => view.render({ headerOnly: true }) });
  const watcher = new AutoAdvanceWatcher({ adapter, advancer, probe });
  const interceptor = new TurnInterceptor({ adapter, commands, doneMarkers });
  const startGuard = new CombatStartGuard({ adapter });
  const openHelp = () => PhaseConfigApp.open("help");
  const view = new CombatWatcher({ createApp: () => new PhaseTrackerApp({ services: { adapter, commands, doneMarkers, probe, openHelp } }) });
  const decorator = new NativeTrackerDecorator({ open: () => view.open() });

  const refuseBack = (combat) => (backTarget(CombatSnapshot.from(combat, adapter)).refuse ? "NoEarlierPhase" : null);
  commands.register("advance", (combat, { force = true } = {}) => advancer.advance(combat, { force }));
  commands.register("complete", (combat) => advancer.complete(combat));
  commands.register("back", (combat) => advancer.back(combat), { precheck: refuseBack });
  commands.register("toggle", (combat, payload) => setup.toggle(combat, payload));
  commands.register("setDc", (combat, payload) => classifier.setDc(combat, payload));
  commands.register("assign", (combat, payload) => classifier.assign(combat, payload));

  Object.assign(services, { commands, advancer, classifier, setup, probe, watcher, interceptor, startGuard, view, decorator });
}

Hooks.once("init", () => {
  registerSettings({ onViewChange: () => services.view?.render(), SettingsMenu: PhaseConfigApp });
  build();
  CombatSorter.install();
  // Registered at init so the turn order is fixed before any other module's listener runs.
  ErrorGuard.on("updateCombat", "sort", (combat, changed) => CombatSorter.onUpdateCombat(combat, changed));
});

Hooks.once("setup", () => {
  services.startGuard.install();
  services.interceptor.install();
});

Hooks.once("ready", () => {
  const { commands, advancer, classifier, setup, probe, watcher, interceptor, startGuard, view, decorator } = services;
  startGuard.check();
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
    return Promise.all([
      classifier.onUpdateCombat(combat, changed, options),
      started ? advancer.afterNativeStart(combat) : watcher.onUpdateCombat(combat, changed, options),
    ]);
  });
  ErrorGuard.on("createCombatant", "combatant", (combatant, options) => {
    classifier.onCreateCombatant(combatant);
    watcher.onCreateCombatant(combatant, options);
  });
  ErrorGuard.on("updateCombatant", "combatant", (combatant, changes, options) => {
    classifier.onUpdateCombatant(combatant, changes, options);
    watcher.onUpdateCombatant(combatant, changes, options);
  });
  ErrorGuard.on("deleteCombatant", "combatant", (combatant, options) => watcher.onDeleteCombatant(combatant, options));
  for (const hook of ["createActiveEffect", "deleteActiveEffect"]) {
    ErrorGuard.on(hook, "defeat", (effect) => watcher.onActiveEffect(effect));
  }
  ErrorGuard.on("updateActiveEffect", "defeat", (effect, changes) => watcher.onActiveEffect(effect, changes));
  ErrorGuard.on("userConnected", "active-gm", () => watcher.onUserConnected());
  ErrorGuard.on("closeApplicationV2", "busy", () => probe.poke());
  ErrorGuard.on("closeDialog", "busy", () => probe.poke());

  // The phase window, on every client.
  ErrorGuard.on("updateCombat", "view", (combat, changed) => view.onUpdateCombat(combat, changed));
  ErrorGuard.on("createCombat", "view", () => view.render());
  ErrorGuard.on("deleteCombat", "view", (combat) => {
    view.onDeleteCombat(combat);
    view.render();
  });
  ErrorGuard.on("createCombatant", "view", () => view.render());
  ErrorGuard.on("updateCombatant", "view", (combatant, changes) => view.onUpdateCombatant(combatant, changes));
  ErrorGuard.on("deleteCombatant", "view", () => view.render());
  ErrorGuard.on("renderCombatTracker", "tracker-button", (app, element) => decorator.onRender(app, element));

  if (game.user.isActiveGM) watcher.reviewAll();
  view.openIfRunning();
});
