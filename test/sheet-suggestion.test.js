import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import { suggestedPhase } from "../scripts/helpers/sheet-suggestion.js";

const NAMES = { epicBoss: "Epic Boss", boss: "Boss", miniBoss: "Mini-Boss", fast: "Fast", enemies: "Enemies", slow: "Slow" };
const nameOf = (phase) => phase.name ?? NAMES[phase.id];

describe("phase suggested by the sheet", () => {
  it("matches a creature phase by its whole name, ignoring case and spaces around it", () => {
    assert.equal(suggestedPhase(["Longsword", "Boss"], defaultPlan(), nameOf), "boss");
    assert.equal(suggestedPhase(["  epic boss "], defaultPlan(), nameOf), "epicBoss");
    assert.equal(suggestedPhase(["Boss Fight", "Bossy"], defaultPlan(), nameOf), null);
  });

  it("takes the earliest phase when several match", () => {
    assert.equal(suggestedPhase(["Mini-Boss", "Boss"], defaultPlan(), nameOf), "boss");
  });

  it("never suggests Fast, Enemies or Slow", () => {
    assert.equal(suggestedPhase(["Fast", "Enemies", "Slow"], defaultPlan(), nameOf), null);
  });

  it("follows a phase the GM renamed, and suggests nothing without items", () => {
    const plan = defaultPlan().map((phase) => (phase.id === "boss" ? { ...phase, name: "Chefe" } : phase));
    assert.equal(suggestedPhase(["Chefe"], plan, nameOf), "boss");
    assert.equal(suggestedPhase(["Boss"], plan, nameOf), null);
    assert.equal(suggestedPhase([], plan, nameOf), null);
    assert.equal(suggestedPhase(undefined, plan, nameOf), null);
  });
});
