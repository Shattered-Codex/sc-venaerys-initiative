import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";
import PhasedCombatTracker from "../scripts/applications/PhasedCombatTracker.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const PARTS = { header: { template: "header.hbs", templates: [] }, tracker: { template: "core-tracker.hbs", templates: [], scrollable: [""] }, footer: { template: "footer.hbs", templates: [] } };

class CoreTracker {
  static PARTS = PARTS;
  groupsRendered = 0;
  _configureRenderParts() {
    return structuredClone(this.constructor.PARTS);
  }
  renderGroups() {
    this.groupsRendered += 1;
  }
  _attachFrameListeners() {}
  _getEntryContextOptions() {
    return [{ name: "core" }];
  }
}

function setup({ phased = true, isGM = true, combatants, commands = {} } = {}) {
  installGame({ isGM, isActiveGM: isGM });
  globalThis.CONFIG.ui = { combat: CoreTracker };
  globalThis.foundry.utils.deepClone = (value) => structuredClone(value);
  globalThis.game.release = { generation: 13 };
  const probe = { isWaiting: () => false };
  PhasedCombatTracker.install({ adapter: null, commands, doneMarkers: {}, probe, openHelp: () => {} });
  const combat = fakeCombat({ round: 2, phased, combatants: combatants ?? [fakeCombatant({ id: "a", initiative: 15, flags: { side: "players", phase: "fast" } })] });
  const tracker = new CONFIG.ui.combat();
  Object.defineProperty(tracker, "viewed", { value: combat });
  return { combat, tracker };
}

describe("PhasedCombatTracker", () => {
  beforeEach(() => PhasedCombatTracker.expanded.clear());

  it("extends the tracker class the system registered", () => {
    setup();
    assert.ok(new CONFIG.ui.combat() instanceof CoreTracker);
    assert.notEqual(CONFIG.ui.combat, CoreTracker);
  });

  it("always puts the panel between header and tracker and keeps the core template without phases", () => {
    const { tracker } = setup({ phased: false });
    const parts = tracker._configureRenderParts({});
    assert.deepEqual(Object.keys(parts), ["header", "sviPanel", "tracker", "footer"]);
    assert.equal(parts.tracker.template, "core-tracker.hbs");
    assert.equal(PARTS.sviPanel, undefined, "the class's own parts are not mutated");
  });

  it("swaps the tracker template, with the row partial, in a phased combat and keeps other settings", () => {
    const { tracker } = setup();
    const parts = tracker._configureRenderParts({});
    assert.match(parts.tracker.template, /combat-tracker\/tracker\.hbs$/);
    assert.ok(parts.tracker.templates.some((t) => t.endsWith("combat-tracker/row.hbs")));
    assert.deepEqual(parts.tracker.scrollable, [""]);
    assert.match(parts.sviPanel.template, /combat-tracker\/panel\.hbs$/);
  });

  it("leaves the system's grouping alone without phases and skips it with phases", () => {
    const off = setup({ phased: false }).tracker;
    off.renderGroups({});
    assert.equal(off.groupsRendered, 1);
    const on = setup().tracker;
    on.renderGroups({});
    assert.equal(on.groupsRendered, 0);
  });

  it("joins the phase rows with the core rows, without the core's single active row", () => {
    const model = {
      phases: [
        { waitingForGm: true, label: "Waiting" },
        { id: "enemies", rows: [{ isGroup: true, key: "g", children: [{ id: "k1" }, { id: "gone" }] }, { id: "x" }] },
      ],
    };
    const turns = [{ id: "k1", css: "active hide", hidden: true, isDefeated: false }, { id: "x", css: "" }];
    const [waiting, enemies] = PhasedCombatTracker.layout(model, turns);
    assert.equal(waiting.waitingForGm, true);
    const [group, x] = enemies.rows;
    assert.deepEqual(group.children.map((c) => c.id), ["k1"]);
    assert.equal(group.children[0].css, "hide");
    assert.equal(group.children[0].svi.id, "k1");
    assert.equal(typeof x.sviLabels.hidden, "string");
  });

  it("gives whoever awaits a roll the same joined row, found by the context menu too", () => {
    const model = { phases: [{ id: "fast", rows: [{ id: "a" }] }], pending: [{ id: "p", rollButton: { label: "Roll" } }, { id: "gone" }] };
    const rows = PhasedCombatTracker.joinRows(model.pending, [{ id: "p", css: "active" }, { id: "a", css: "" }]);
    assert.deepEqual(rows.map((row) => [row.id, row.css, row.svi.rollButton.label]), [["p", "", "Roll"]]);
    assert.equal(PhasedCombatTracker.rowOf(model, "p"), model.pending[0]);
    assert.equal(PhasedCombatTracker.rowOf(model, "nobody"), null);
  });

  it("gives a player no trace of a hidden combatant", () => {
    setup({
      isGM: false,
      combatants: [
        fakeCombatant({ id: "dragon", name: "Secret Dragon", initiative: 20, hidden: true, visible: false, flags: { side: "enemies", phase: "epicBoss" } }),
        fakeCombatant({ id: "ana", name: "Ana", initiative: 16, flags: { side: "players", phase: "fast" } }),
      ],
    });
    const combat = fakeCombat({
      round: 2,
      turn: 0,
      combatants: [
        fakeCombatant({ id: "dragon", name: "Secret Dragon", initiative: 20, hidden: true, visible: false, flags: { side: "enemies", phase: "epicBoss" } }),
        fakeCombatant({ id: "ana", name: "Ana", initiative: 16, flags: { side: "players", phase: "fast" } }),
      ],
    });
    const text = JSON.stringify(PhasedCombatTracker.project(combat));
    assert.equal(text.includes("Secret Dragon"), false);
    assert.equal(text.includes("dragon"), false);
  });
});

/** A frame element that keeps its listeners, with phase sections that answer `closest`. */
function fakeFrame(rowPhase) {
  const listeners = {};
  const sections = new Map();
  const section = (id) => {
    if (!sections.has(id)) {
      const classes = new Set();
      sections.set(id, { dataset: { phaseId: id }, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), has: (c) => classes.has(c) }, contains: () => false });
    }
    return sections.get(id);
  };
  const element = {
    addEventListener: (type, listener) => (listeners[type] = listener),
    querySelector: (selector) => (selector.startsWith("li.combatant") ? { closest: () => section(rowPhase) } : null),
    querySelectorAll: (selector) => [...sections.values()].filter((s) => selector !== ".svi-drop-target" || s.classList.has("svi-drop-target")),
  };
  const dragOn = (phaseId, data = {}) => {
    const store = { ...data };
    return {
      target: { closest: (selector) => (selector.startsWith("li.svi-phase") ? section(phaseId) : null) },
      dataTransfer: { types: Object.keys(store), getData: (type) => store[type] ?? "", dropEffect: "" },
      prevented: false,
      preventDefault() {
        this.prevented = true;
      },
    };
  };
  return { element, listeners, section, dragOn };
}

const DRAG = "application/x-sc-venaerys-initiative-combatant";

describe("PhasedCombatTracker moves", () => {
  const recorder = () => {
    const calls = [];
    return { calls, execute: (...args) => calls.push(args) };
  };

  it("adds \"Move to phase…\" after the core entries, for the GM in a phased combat", () => {
    const gm = setup().tracker;
    const entries = gm._getEntryContextOptions();
    assert.equal(entries[0].name, "core");
    const move = entries.at(-1);
    assert.equal(move.label, "SC_VENAERYS_INITIATIVE.Tracker.MoveToPhase");
    assert.equal(move.visible(), true);
    assert.equal(setup({ phased: false }).tracker._getEntryContextOptions().at(-1).visible(), false);
    assert.equal(setup({ isGM: false }).tracker._getEntryContextOptions().at(-1).visible(), false);
  });

  it("finds a combatant's row inside groups", () => {
    const model = { phases: [{ waitingForGm: true }, { rows: [{ isGroup: true, children: [{ id: "k1" }, { id: "k2" }] }, { id: "x" }] }] };
    assert.equal(PhasedCombatTracker.rowOf(model, "k2").id, "k2");
    assert.equal(PhasedCombatTracker.rowOf(model, "x").id, "x");
    assert.equal(PhasedCombatTracker.rowOf(model, "nobody"), null);
  });

  it("assigns the phase a GM drops a row onto", () => {
    const commands = recorder();
    const { tracker, combat } = setup({ commands });
    const frame = fakeFrame("fast");
    Object.defineProperty(tracker, "element", { value: frame.element });
    tracker._attachFrameListeners();
    const over = frame.dragOn("slow", { [DRAG]: "a" });
    frame.listeners.dragover(over);
    assert.equal(over.prevented, true);
    assert.equal(frame.section("slow").classList.has("svi-drop-target"), true);
    frame.listeners.drop(frame.dragOn("slow", { [DRAG]: "a" }));
    assert.equal(frame.section("slow").classList.has("svi-drop-target"), false);
    assert.deepEqual(commands.calls, [["assign", combat, { combatantId: "a", phaseId: "slow" }]]);
  });

  it("ignores a drop on the row's own phase, other drags and players", () => {
    const commands = recorder();
    const { tracker } = setup({ commands });
    const frame = fakeFrame("fast");
    Object.defineProperty(tracker, "element", { value: frame.element });
    tracker._attachFrameListeners();
    frame.listeners.drop(frame.dragOn("fast", { [DRAG]: "a" }));
    const foreign = frame.dragOn("slow", { "text/plain": "{}" });
    frame.listeners.dragover(foreign);
    frame.listeners.drop(foreign);
    assert.equal(foreign.prevented, false);
    assert.deepEqual(commands.calls, []);

    const player = setup({ isGM: false, commands }).tracker;
    const playerFrame = fakeFrame("fast");
    Object.defineProperty(player, "element", { value: playerFrame.element });
    player._attachFrameListeners();
    playerFrame.listeners.drop(playerFrame.dragOn("slow", { [DRAG]: "a" }));
    assert.deepEqual(commands.calls, []);
  });
});

describe("tracker templates", () => {
  const read = (name) => readFile(new URL(`../templates/combat-tracker/${name}`, import.meta.url), "utf8");

  it("keep the core's row markup, so core handlers keep working", async () => {
    const row = await read("row.hbs");
    assert.match(row, /<li class="combatant [^"]*" data-combatant-id="\{\{ id \}\}" data-action="activateCombatant"[^>]*>/);
    for (const selector of ["token-image", "token-name", "combatant-controls", "token-effects", "token-initiative", "initiative-input"]) {
      assert.ok(row.includes(selector), selector);
    }
  });

  it("give module controls prefixed actions and never the combat-control class", async () => {
    for (const name of ["row.hbs", "tracker.hbs", "panel.hbs"]) {
      const text = await read(name);
      for (const tag of text.match(/<(button|select)[^>]*data-action="svi[^"]*"[^>]*>/g) ?? []) {
        assert.doesNotMatch(tag, /combat-control/, `${name}: ${tag}`);
      }
    }
    assert.match(await read("row.hbs"), /<select class="svi-phase-select" data-action="sviNoop"/);
  });

  it("never give a phase section the combatant class", async () => {
    const tracker = await read("tracker.hbs");
    for (const tag of tracker.match(/<li class="[^"]*svi-[^"]*"/g) ?? []) assert.doesNotMatch(tag, /\bcombatant\b/, tag);
  });
});
