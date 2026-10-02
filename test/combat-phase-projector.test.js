import assert from "node:assert/strict";
import { describe, it } from "node:test";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";

const options = (extra = {}) => ({
  localize: (key) => `L(${key})`,
  format: (key, data) => `F(${key}:${JSON.stringify(data)})`,
  decimals: 2,
  ...extra,
});
const settings = { showDcToPlayers: false, autoAdvance: true };
const project = (view, isGM, extra) => CombatPhaseProjector.project(view, { isGM }, settings, options(extra));
const rowsOf = (model, id) => model.phases.find((p) => p.id === id)?.rows ?? [];

/** Round 2, Fast current; a hidden dragon in Epic Boss and a hidden kobold in Enemies. */
function encounter() {
  return combatView({
    round: 2,
    on: "bruno",
    combatants: [
      enemy("dragon", "epicBoss", { name: "Secret Dragon", hidden: true, visible: false, initiative: 21.5, img: "dragon.webp" }),
      player("ana", "fast", { name: "Ana", initiative: 14.18, done: 2, isOwner: true }),
      player("bruno", "fast", { name: "Bruno", initiative: 12 }),
      enemy("kob", "enemies", { name: "Hidden Kobold", hidden: true, visible: false, initiative: 9.5 }),
      enemy("gob", "enemies", { name: "Goblin", initiative: 12 }),
      player("pend", null, { name: "Hidden Pending", visible: false }),
    ],
  });
}

describe("CombatPhaseProjector for a player", () => {
  it("carries no name, id, image or initiative of a hidden combatant, and no DC with the setting off", () => {
    const model = project(encounter(), false);
    const text = JSON.stringify(model);
    for (const secret of ["dragon", "Secret Dragon", "dragon.webp", "21.5", "kob", "Hidden Kobold", "9.5", "Hidden Pending", "epicBoss"]) {
      assert.equal(text.includes(secret), false, secret);
    }
    assert.equal(model.dc, null);
    assert.equal(model.gm, null);
  });

  it("counts only visible members and shows the past phase compact", () => {
    const view = encounter();
    view.turn = 4; // Goblin, Enemies current
    view.combatants[2].done = 2;
    const model = project(view, false);
    const enemies = model.phases.find((p) => p.id === "enemies");
    assert.equal(enemies.count, 'F(SC_VENAERYS_INITIATIVE.Tracker.DoneCount:{"done":0,"total":1})');
    const fast = model.phases.find((p) => p.id === "fast");
    assert.equal(fast.compact, "Ana, Bruno");
  });

  it("lets the owner mark their own combatant in the current phase, and nobody else's", () => {
    const model = project(encounter(), false);
    const [ana, bruno] = rowsOf(model, "fast");
    assert.equal(ana.doneButton.big, true);
    assert.equal(ana.doneButton.pressed, true);
    assert.equal(bruno.doneButton, null);
    assert.equal(bruno.doneStatus, true);
    assert.equal(ana.select, null);
  });
});

describe("CombatPhaseProjector for the GM", () => {
  it("brings every phase and the GM-only fields, in turn order", () => {
    const view = encounter();
    view.combatants[2].nextPhase = "slow";
    view.combatants[2].pinned = true;
    const model = project(view, true);
    assert.equal(model.phases.length, 7);
    assert.deepEqual(rowsOf(model, "fast").map((r) => r.id), ["ana", "bruno"]);
    const dragon = rowsOf(model, "epicBoss")[0];
    assert.equal(dragon.hidden, true);
    const bruno = rowsOf(model, "fast")[1];
    assert.equal(bruno.pinned, true);
    assert.match(bruno.deferred, /NextRound/);
    assert.equal(bruno.select.options.find((o) => o.selected).value, "slow");
    assert.ok(model.gm);
    assert.equal(model.dc.value, 15);
  });

  it("flags a player placed without a roll, and offers skipping future phases", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast"), enemy("g"), player("s", "slow", { initiative: null })] });
    const model = project(view, true);
    const slow = rowsOf(model, "slow")[0];
    assert.equal(slow.noRoll, true);
    assert.ok(slow.skipButton);
    assert.equal(slow.doneButton, null);
  });

  it("warns about pending rolls, a dialog, a complete phase with auto advance off, and no phases", () => {
    const lock = combatView({ round: 1, on: "boss", combatants: [enemy("boss", "boss", { done: 1 }), enemy("g"), player("p", null)] });
    const texts = (model) => model.gm.warnings.map((w) => w.text).join("|");
    assert.match(texts(project(lock, true)), /AwaitingRollsOne/);
    const off = CombatPhaseProjector.project(lock, { isGM: true }, { showDcToPlayers: false, autoAdvance: false }, options({ waitingForDialog: true }));
    assert.match(texts(off), /DialogWait/);
    const done = combatView({ round: 2, on: "a", combatants: [player("a", "fast", { done: 2 }), enemy("g")] });
    const complete = CombatPhaseProjector.project(done, { isGM: true }, { showDcToPlayers: false, autoAdvance: false }, options());
    assert.match(texts(complete), /PhaseComplete/);
    assert.equal(complete.gm.advanceStrong, true);
    const dead = combatView({ round: 2, on: "a", combatants: [player("a", "fast", { isDefeated: true })] });
    assert.match(texts(project(dead, true)), /NoPhases/);
  });

  it("disables the controls and the done buttons before the start", () => {
    const model = project(combatView({ round: 0, combatants: [player("a", "fast"), enemy("g")] }), true);
    assert.equal(model.gm.controlsDisabled, true);
    assert.equal(model.gm.phasesEditable, true);
    assert.equal(rowsOf(model, "fast")[0].doneButton, null);
  });

  it("groups identical enemies, with the open state kept outside", () => {
    const view = combatView({ round: 2, on: "k2", combatants: [enemy("k1", "enemies", { name: "Kobold", groupKey: "kob" }), enemy("k2", "enemies", { name: "Kobold", groupKey: "kob", done: 2 })] });
    const closed = rowsOf(project(view, true), "enemies");
    assert.equal(closed.length, 1);
    assert.equal(closed[0].name, "Kobold ×2");
    assert.equal(closed[0].count, "1/2");
    const open = rowsOf(project(view, true, { expanded: new Set([closed[0].key]) }), "enemies");
    assert.equal(open[0].expanded, true);
    assert.equal(open[0].children.length, 2);
  });

  it("offers the GM to complete a group of the current phase until every living member is done", () => {
    const kobolds = (done) => combatView({ round: 2, on: "k2", combatants: [enemy("k1", "enemies", { name: "Kobold", groupKey: "kob", done }), enemy("k2", "enemies", { name: "Kobold", groupKey: "kob", done: 2 })] });
    const [group] = rowsOf(project(kobolds(null), true), "enemies");
    assert.match(group.completeButton.label, /Tracker\.CompleteGroupLabel.*Kobold/);
    assert.equal(rowsOf(project(kobolds(null), false), "enemies")[0].completeButton, null);
    assert.equal(rowsOf(project(kobolds(2), true), "enemies")[0].completeButton, null);
    const future = combatView({ round: 2, on: "ana", combatants: [player("ana", "fast"), enemy("k1", "enemies", { groupKey: "kob" }), enemy("k2", "enemies", { groupKey: "kob" })] });
    assert.equal(rowsOf(project(future, true), "enemies")[0].completeButton, null);
  });
});

describe("initiative as the core tracker shows it", () => {
  it("uses the configured decimals for everyone once any visible combatant has a fraction", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast", { initiative: 14.18 }), player("b", "fast", { initiative: 12 })] });
    assert.deepEqual(rowsOf(project(view, true), "fast").map((r) => r.initiative), ["14.18", "12.00"]);
  });

  it("shows whole numbers when nobody visible has a fraction; a hidden fraction does not count for players", () => {
    const view = combatView({
      round: 2,
      on: "a",
      combatants: [player("a", "fast", { initiative: 14 }), player("b", "fast", { initiative: 12 }), enemy("h", "enemies", { initiative: 9.5, visible: false })],
    });
    assert.deepEqual(rowsOf(project(view, false), "fast").map((r) => r.initiative), ["14", "12"]);
    assert.deepEqual(rowsOf(project(view, true), "fast").map((r) => r.initiative), ["14.00", "12.00"]);
  });

  it("shows enemies as a dash with an accessible name, while their value still counts for the decimals", () => {
    const view = combatView({ round: 2, on: "a", combatants: [player("a", "fast", { initiative: 14 }), enemy("g", "enemies", { initiative: 12.5 })] });
    const model = project(view, false);
    const goblin = rowsOf(model, "enemies")[0];
    assert.equal(goblin.initiative, "—");
    assert.equal(goblin.initiativeLabel, "L(SC_VENAERYS_INITIATIVE.Tracker.NoInitiative)");
    assert.equal(rowsOf(model, "fast")[0].initiative, "14.00");
  });

  it("shows nothing for a missing initiative", () => {
    assert.equal(CombatPhaseProjector.formatInitiative(null, 2), "");
  });
});

describe("CombatPhaseProjector pointer marker", () => {
  const pointerRows = (model) => model.phases.flatMap((p) => p.rows ?? []).filter((r) => r.pointer);

  it("marks only the member under the pointer, for the GM", () => {
    const rows = pointerRows(project(encounter(), true));
    assert.deepEqual(rows.map((r) => r.id), ["bruno"]);
    assert.match(rows[0].pointer.label, /Tracker\.PointerLabel/);
  });

  it("never reaches a player", () => {
    assert.deepEqual(pointerRows(project(encounter(), false)), []);
  });

  it("marks nobody before the start", () => {
    const view = encounter();
    view.started = false;
    assert.deepEqual(pointerRows(project(view, true)), []);
  });
});

describe("CombatPhaseProjector DC from base + CR", () => {
  const gm = (view, extra = {}) => CombatPhaseProjector.project(view, { isGM: true }, { ...settings, ...extra }, options()).gm;
  const baseOnly = (model) => model.warnings.find((w) => w.text.includes("Gm.DcBaseOnly"));

  it("offers Recalculate with the base and CR of the combat", () => {
    const view = combatView({ round: 0, combatants: [], dcRule: { source: "baseCr", base: 10, referenceCr: 3 } });
    assert.match(gm(view).dcRecalculate.label, /RecalculateLabel.*"base":10.*"cr":3/);
    assert.equal(baseOnly(gm(view)), undefined);
  });

  it("offers Recalculate on a typed DC only when the world uses base + CR", () => {
    const view = combatView({ round: 0, combatants: [], dcRule: { source: "manual", base: null, referenceCr: null } });
    assert.equal(gm(view).dcRecalculate, null);
    assert.match(gm(view, { dcSource: "baseCr" }).dcRecalculate.label, /Gm\.Recalculate\)/);
  });

  it("warns before the start when the DC stayed at the base", () => {
    const view = combatView({ round: 0, combatants: [], dc: 10, dcRule: { source: "baseCr", base: 10, referenceCr: null } });
    assert.match(baseOnly(gm(view)).hint, /"base":10/);
    assert.equal(baseOnly(gm({ ...view, round: 1, started: true })), undefined);
  });
});
