import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { MODULE_ID } from "../scripts/constants/module-constants.js";
import { customSound, normalizePhaseSound, setPhaseSound, silencesTheme } from "../scripts/helpers/phase-sound.js";
import ErrorGuard from "../scripts/services/ErrorGuard.js";
import PhaseAutomationRunner from "../scripts/services/PhaseAutomationRunner.js";
import PhaseSoundGuard from "../scripts/services/PhaseSoundGuard.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

const KEY = MODULE_ID;

describe("phase sound rules", () => {
  it("defaults to no sound, and types every field", () => {
    assert.deepEqual(normalizePhaseSound(undefined), { mode: "none", src: "", volume: 70 });
    assert.deepEqual(normalizePhaseSound({ mode: "loud", src: " a.ogg ", volume: 500 }), { mode: "none", src: "a.ogg", volume: 100 });
    assert.deepEqual(normalizePhaseSound({ mode: "custom", volume: "" }), { mode: "custom", src: "", volume: 70 });
  });

  it("silences the theme unless the GM chose it, and plays only a chosen file", () => {
    assert.equal(silencesTheme({}), true);
    assert.equal(silencesTheme({ sound: { mode: "theme" } }), false);
    assert.equal(silencesTheme({ sound: { mode: "custom", src: "a.ogg" } }), true);
    assert.equal(customSound({ sound: { mode: "none", src: "a.ogg" } }), null);
    assert.equal(customSound({ sound: { mode: "custom" } }), null);
    assert.deepEqual(customSound({ sound: { mode: "custom", src: "a.ogg", volume: 50 } }), { src: "a.ogg", volume: 0.5 });
  });

  it("changes one phase in the plan and leaves no field behind for the default", () => {
    const plan = [{ id: "a" }, { id: "b" }];
    const custom = setPhaseSound(setPhaseSound(plan, "a", { mode: "custom" }), "a", { src: "a.ogg" });
    assert.deepEqual(custom, [{ id: "a", sound: { mode: "custom", src: "a.ogg", volume: 70 } }, { id: "b" }]);
    assert.deepEqual(setPhaseSound(plan, "b", { mode: "theme" })[1], { id: "b", sound: { mode: "theme", src: "", volume: 70 } });
    assert.deepEqual(setPhaseSound(setPhaseSound(custom, "a", { src: "" }), "a", { mode: "none" }), plan);
  });
});

describe("phase sound in a combat", () => {
  let played;

  function combatWith({ sound, phased = true, hidden = false, isGM = true }) {
    const combat = fakeCombat({
      round: 2,
      phased,
      combatants: [
        fakeCombatant({ id: "a", initiative: 18, flags: { side: "players", phase: "fast", done: 2 } }),
        fakeCombatant({ id: "boss", initiative: 10, hidden, visible: !hidden, flags: { side: "enemies", phase: "boss" } }),
      ],
    });
    if (phased) combat.flags[KEY].plan = combat.flags[KEY].plan.map((p) => (p.id === "boss" ? { ...p, sound } : p));
    installGame({ isGM, isActiveGM: isGM, combats: [combat] });
    globalThis.foundry.audio = { AudioHelper: { play: (data) => played.push([data.src, data.volume]) } };
    combat.turn = combat.turns.findIndex((c) => c.id === "boss");
    combat.previous = { round: 2, combatantId: "a" };
    return combat;
  }

  beforeEach(() => {
    played = [];
    ErrorGuard.reset();
  });

  it("keeps the core quiet in a phase unless it has the core's sound, never at the start or without phases", () => {
    const heard = [];
    class Combat {
      _playCombatSound(announcement) {
        heard.push(announcement);
      }
    }
    const silent = combatWith({ sound: undefined });
    globalThis.CONFIG.Combat = { ...globalThis.CONFIG.Combat, documentClass: Combat };
    new PhaseSoundGuard({ adapter: null }).install();
    const play = (combat, announcement) => Combat.prototype._playCombatSound.call(combat, announcement);
    play(silent, "yourTurn");
    play(silent, "nextUp");
    assert.deepEqual(heard, []);
    play(silent, "startEncounter");
    play(combatWith({ sound: { mode: "theme" } }), "yourTurn");
    play(combatWith({ sound: { mode: "none" }, phased: false }), "nextUp");
    assert.deepEqual(heard, ["startEncounter", "yourTurn", "nextUp"]);
  });

  it("plays the phase's own file once when it starts, only where the phase is seen", async () => {
    const sound = { mode: "custom", src: "roar.ogg", volume: 40 };
    const options = { [KEY]: { reason: "advance" } };
    const runner = new PhaseAutomationRunner({ adapter: null });
    const combat = combatWith({ sound });
    await runner.onUpdateCombat(combat, { turn: combat.turn }, options);
    await runner.onUpdateCombat(combat, { turn: combat.turn }, options);
    assert.deepEqual(played, [["roar.ogg", 0.4]]);
    const hidden = combatWith({ sound, hidden: true, isGM: false });
    await new PhaseAutomationRunner({ adapter: null }).onUpdateCombat(hidden, { turn: hidden.turn }, options);
    assert.equal(played.length, 1);
  });
});
