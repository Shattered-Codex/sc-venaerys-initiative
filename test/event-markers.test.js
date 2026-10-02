import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { automaticPhaseOf, classifyCleared, classifyCombatant, classifyRoll } from "../scripts/helpers/phase-classifier.js";
import { advanceTarget, canToggleDone } from "../scripts/helpers/phase-progression.js";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import CombatSnapshot from "../scripts/services/CombatSnapshot.js";
import CombatantClassifier from "../scripts/services/CombatantClassifier.js";
import EventMarkers from "../scripts/services/EventMarkers.js";
import Dnd5eAdapter from "../scripts/services/adapters/Dnd5eAdapter.js";
import { combatView, combatant, enemy, player } from "./helpers/combat-view.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = "sc-venaerys-initiative";

const marker = (id = "lair-1", overrides = {}) =>
  combatant({ id, side: "event", phase: "lair", pinned: true, initiative: 0, hasToken: false, ...overrides });

describe("event markers in the rules", () => {
  it("never get a phase, a side or a roll from the rules", () => {
    assert.equal(classifyCombatant(marker(), 15), null);
    assert.equal(classifyCombatant(marker("m", { pinned: false }), 15), null);
    assert.equal(classifyRoll(marker("m", { initiative: 19 }), 15), null);
    assert.equal(automaticPhaseOf(marker(), 15, true), "lair");
  });

  it("get their fixed initiative back after a reset, so Roll All passes them by", () => {
    assert.deepEqual(classifyCleared(marker("m", { initiative: null })), { id: "m", initiative: 0 });
    assert.deepEqual(classifyCombatant(marker("m", { initiative: null }), 15), { id: "m", initiative: 0 });
  });

  it("skip an event phase without a marker and stop at one with a marker until the GM marks it", () => {
    const empty = combatView({ round: 2, on: "slow", combatants: [player("ana", "fast", { done: 2 }), player("slow", "slow")] });
    assert.equal(advanceTarget(empty).round, 3);
    const lair = marker();
    const view = combatView({ round: 2, on: "slow", combatants: [player("ana", "fast", { done: 2 }), player("slow", "slow"), lair] });
    assert.deepEqual(advanceTarget(view), { turn: 2, phaseId: "lair" });
    const there = combatView({ round: 2, on: "lair-1", combatants: [player("slow", "slow", { done: 2 }), lair] });
    assert.equal(canToggleDone(there, lair, { isGM: false }), false);
    assert.equal(canToggleDone(there, lair, { isGM: true }), true);
  });
});

describe("EventMarkers", () => {
  function phasedCombat() {
    const combat = fakeCombat({ round: 0 });
    combat.created = [];
    combat.createEmbeddedDocuments = async (type, data, options) => {
      combat.created.push({ type, data, options });
      return data;
    };
    return combat;
  }

  it("adds a marker with no actor to an event phase, named after it and pinned there", async () => {
    installGame();
    const combat = phasedCombat();
    await new EventMarkers().add(combat, { phaseId: "lair" });
    const [{ type, data: [data], options }] = combat.created;
    assert.equal(type, "Combatant");
    assert.equal(data.name, "SC_VENAERYS_INITIATIVE.Phase.Lair");
    assert.equal(data.initiative, 0);
    assert.equal("actorId" in data || "tokenId" in data, false);
    assert.deepEqual(data.flags[KEY], { side: "event", phase: "lair", pinned: true });
    assert.equal(options[KEY].reason, "marker");
  });

  it("refuses a phase that is not an event phase, and a combat without phases", async () => {
    installGame();
    const combat = phasedCombat();
    assert.equal(await new EventMarkers().add(combat, { phaseId: "boss" }), null);
    combat.flags[KEY].enabled = false;
    assert.equal(await new EventMarkers().add(combat, { phaseId: "lair" }), null);
    assert.equal(combat.created.length, 0);
  });

  it("are told apart by their side flag", () => {
    assert.equal(CombatSnapshot.isEventMarker(fakeCombatant({ id: "m", flags: { side: "event" } })), true);
    assert.equal(CombatSnapshot.isEventMarker(fakeCombatant({ id: "e", flags: { side: "enemies" } })), false);
    assert.equal(CombatSnapshot.isEventMarker(null), false);
  });
});

describe("moving markers", () => {
  function setup() {
    installGame();
    const lair = fakeCombatant({ id: "lair-1", initiative: 0, hasToken: false, flags: { side: "event", phase: "lair", pinned: true } });
    const goblin = fakeCombatant({ id: "goblin", initiative: 12, flags: { side: "enemies", phase: "enemies" } });
    const combat = fakeCombat({ round: 2, combatants: [goblin, lair] });
    const applied = [];
    const classifier = new CombatantClassifier({ adapter: null, writer: { apply: async (_c, changes, options) => applied.push({ changes, options }) } });
    return { combat, classifier, applied };
  }

  it("keeps markers in event phases and everyone else out of them", async () => {
    const { combat, classifier, applied } = setup();
    await classifier.assign(combat, { combatantId: "lair-1", phaseId: "boss" });
    await classifier.assign(combat, { combatantId: "goblin", phaseId: "lair" });
    await classifier.assign(combat, { combatantId: "lair-1", phaseId: null });
    assert.deepEqual(applied, []);
    await classifier.assign(combat, { combatantId: "goblin", phaseId: "boss" });
    assert.deepEqual(applied.map((a) => a.changes), [[{ id: "goblin", target: "boss" }]]);
  });
});

describe("markers in the tracker", () => {
  const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2 };
  const settings = { showDcToPlayers: false, autoAdvance: true };
  const view = () => combatView({ round: 2, on: "ana", combatants: [player("ana", "fast"), enemy("gob"), marker()] });
  const phase = (model, id) => model.phases.find((p) => p.id === id);

  it("offers the GM a + on event phases only, and nothing to players", () => {
    const gm = CombatPhaseProjector.project(view(), { isGM: true }, settings, options);
    assert.match(phase(gm, "lair").addMarker.label, /Tracker\.AddMarkerLabel/);
    assert.equal(phase(gm, "boss").addMarker, null);
    const player = CombatPhaseProjector.project(view(), { isGM: false }, settings, options);
    assert.equal(phase(player, "lair").addMarker, null);
  });

  it("shows a marker with no initiative and lets the GM move it only between event phases", () => {
    const gm = CombatPhaseProjector.project(view(), { isGM: true }, settings, options);
    const [row] = phase(gm, "lair").rows;
    assert.equal(row.initiative, "—");
    assert.equal(row.marker, true);
    assert.equal(row.pinned, false);
    assert.deepEqual(row.select.options.map((o) => o.value), ["lair"]);
    const [goblin] = phase(gm, "enemies").rows;
    assert.equal(goblin.select.options.some((o) => o.value === "lair"), false);
    assert.equal(goblin.select.options[0].value, "auto");
  });
});

describe("dnd5e and markers", () => {
  it("gives markers no grouping key and no combat recovery, leaving everyone else to the system", () => {
    installGame();
    const handlers = new Map();
    globalThis.Hooks.on = (name, fn) => handlers.set(name, fn);
    const proto = {
      getGroupingKey() {
        return this.token.getGroupingKey();
      },
      getInitiativeGroupingKey() {
        return this.token.getGroupingKey();
      },
    };
    globalThis.CONFIG.Combatant = { documentClass: { prototype: proto } };
    const isMarker = (c) => c.marker === true;
    new Dnd5eAdapter().guardEventMarkers(isMarker);

    const lair = Object.assign(Object.create(proto), { marker: true, token: null });
    const goblin = Object.assign(Object.create(proto), { marker: false, token: { getGroupingKey: () => "gob" } });
    assert.equal(lair.getGroupingKey(), null);
    assert.equal(lair.getInitiativeGroupingKey(), null);
    assert.equal(goblin.getGroupingKey(), "gob");
    assert.equal(goblin.getInitiativeGroupingKey(), "gob");

    const recovery = handlers.get("dnd5e.preCombatRecovery");
    assert.equal(recovery(lair, ["turnStart"]), false);
    assert.equal(recovery(goblin, ["turnStart"]), undefined);
  });
});
