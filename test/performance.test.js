import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";
import { classifyAll } from "../scripts/helpers/phase-classifier.js";
import { advanceTarget, isPhaseComplete } from "../scripts/helpers/phase-progression.js";
import CombatPhaseProjector from "../scripts/services/CombatPhaseProjector.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";

/**
 * The module's share of a tracker render is one projection of the combat
 * (the template is the core's work). With 40 combatants (identical kobolds
 * in groups, bosses, hidden ones, players in both halves of the party) it has
 * to stay far inside one 16 ms frame, for the GM and for a player.
 */

function bigEncounter() {
  const combatants = [
    enemy("dragon", "epicBoss", { name: "Dragon", hidden: true, visible: false }),
    enemy("priest", "boss", { name: "Priest" }),
    ...Array.from({ length: 6 }, (_, i) => player(`pc${i}`, i < 3 ? "fast" : "slow", { name: `PC ${i}`, initiative: 10 + i, isOwner: i === 0, done: i === 1 ? 2 : null })),
    ...Array.from({ length: 24 }, (_, i) => enemy(`kob${i}`, "enemies", { name: "Kobold", groupKey: "kobold", done: i % 3 ? null : 2 })),
    ...Array.from({ length: 8 }, (_, i) => enemy(`gob${i}`, "enemies", { name: "Goblin", groupKey: "goblin", isDefeated: i === 0 })),
  ];
  return combatView({ round: 2, on: "pc2", combatants });
}

const options = { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}`, decimals: 2, expanded: new Set(["group:enemies:kobold"]) };
const settings = { showDcToPlayers: false, autoAdvance: true };

function median(run, times = 40) {
  for (let i = 0; i < 5; i++) run(); // warm up
  const samples = Array.from({ length: times }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

describe("performance with 40 combatants", () => {
  it("projects the tracker for the GM and for a player well inside a frame", () => {
    const view = bigEncounter();
    assert.equal(view.combatants.length, 40);
    const gm = median(() => CombatPhaseProjector.project(view, { isGM: true }, settings, options));
    const player = median(() => CombatPhaseProjector.project(view, { isGM: false }, settings, options));
    assert.ok(gm < 4, `GM projection took ${gm.toFixed(2)} ms`);
    assert.ok(player < 4, `player projection took ${player.toFixed(2)} ms`);
  });

  it("decides the advance and classifies everyone in well under a millisecond each", () => {
    const view = bigEncounter();
    assert.ok(median(() => advanceTarget(view)) < 1);
    assert.ok(median(() => isPhaseComplete(view, "enemies")) < 1);
    assert.ok(median(() => classifyAll(view)) < 1);
  });
});
