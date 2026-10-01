import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { DEFAULT_PHASES, NEW_PHASE, defaultPlan } from "../scripts/constants/default-phases.js";
import {
  addPhase,
  deletePhase,
  displayName,
  firstPlayerPhaseRank,
  isValidPlanOrder,
  movePhase,
  normalizePlan,
  phaseRank,
  phasesWithoutName,
  renamePhase,
  reorderIds,
  reorderPlan,
  restylePhase,
  validatePlan,
} from "../scripts/helpers/phase-plan.js";

const ids = (plan) => plan.map((phase) => phase.id);
const lookup = (root, path) => path.split(".").reduce((node, key) => node?.[key], root);

describe("default phase template", () => {
  it("is valid and runs Epic Boss, Boss, Mini-Boss, Fast, Enemies, Slow", () => {
    assert.ok(validatePlan(defaultPlan()));
    assert.deepEqual(ids(DEFAULT_PHASES), ["epicBoss", "boss", "miniBoss", "fast", "enemies", "slow"]);
  });

  it("stores name keys and no translated names", () => {
    for (const phase of DEFAULT_PHASES) {
      assert.equal(phase.name, null);
      assert.match(phase.nameKey, /^SC_VENAERYS_INITIATIVE\.Phase\./);
    }
  });

  it("has every default and new-phase name key in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const catalog = JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8"));
      for (const key of [...DEFAULT_PHASES.map((p) => p.nameKey), NEW_PHASE.nameKey]) {
        assert.equal(typeof lookup(catalog, key), "string", `${lang} ${key}`);
      }
    }
  });
});

describe("plan validation", () => {
  it("refuses duplicate ids, missing or doubled built-ins and inverted built-ins", () => {
    const plan = defaultPlan();
    assert.equal(validatePlan([...plan, { ...plan[0] }]), false);
    assert.equal(validatePlan(plan.filter((p) => p.id !== "enemies")), false);
    assert.equal(validatePlan([...plan, { ...plan[3], id: "fast2" }]), false);
    const inverted = reorderIds(ids(plan), "slow", "fast").map((id) => plan.find((p) => p.id === id));
    assert.equal(validatePlan(inverted), false);
  });

  it("refuses a phase with neither a name nor a name key", () => {
    const plan = defaultPlan();
    plan[0] = { ...plan[0], nameKey: null, name: null };
    assert.equal(validatePlan(plan), false);
  });

  it("normalizes a corrupted plan to the default and keeps unknown fields of a valid one", () => {
    assert.deepEqual(normalizePlan("garbage"), defaultPlan());
    assert.deepEqual(normalizePlan([{ id: "x" }]), defaultPlan());
    const plan = defaultPlan();
    plan[1].future = { keep: true };
    const normalized = normalizePlan(plan);
    assert.deepEqual(normalized[1].future, { keep: true });
    assert.notEqual(normalized[1], plan[1], "returns a copy");
  });
});

describe("ranks", () => {
  it("ranks phases by position and puts pending or unknown phases last", () => {
    const plan = defaultPlan();
    assert.equal(phaseRank(plan, "boss"), 1);
    assert.equal(phaseRank(plan, null), plan.length);
    assert.equal(phaseRank(plan, "nope"), plan.length);
    assert.equal(firstPlayerPhaseRank(plan), 3);
  });
});

describe("reordering", () => {
  const plan = defaultPlan();

  it("moves a dragged id before another, or to the end", () => {
    assert.deepEqual(reorderIds(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
    assert.deepEqual(reorderIds(["a", "b", "c"], "a", null), ["b", "c", "a"]);
    assert.deepEqual(reorderIds(["a", "b", "c"], "b", "b"), ["a", "b", "c"]);
  });

  it("lets an extra go before Fast, between the built-ins and after Slow", () => {
    for (const before of ["fast", "enemies", "slow", null]) {
      const next = reorderPlan(plan, reorderIds(ids(plan), "boss", before));
      assert.ok(next && isValidPlanOrder(next), `before ${before}`);
    }
    const boss = reorderPlan(plan, reorderIds(ids(plan), "boss", "slow"));
    assert.deepEqual(ids(boss), ["epicBoss", "miniBoss", "fast", "enemies", "boss", "slow"]);
  });

  it("refuses an order that inverts the built-ins", () => {
    assert.equal(reorderPlan(plan, reorderIds(ids(plan), "slow", "fast")), null);
    assert.equal(reorderPlan(plan, reorderIds(ids(plan), "enemies", "fast")), null);
    assert.equal(reorderPlan(plan, reorderIds(ids(plan), "slow", "enemies")), null);
  });

  it("moves up and down by one, refusing edges and inversions", () => {
    assert.deepEqual(ids(movePhase(plan, "miniBoss", 1)), ["epicBoss", "boss", "fast", "miniBoss", "enemies", "slow"]);
    assert.equal(movePhase(plan, "epicBoss", -1), null);
    assert.equal(movePhase(plan, "slow", 1), null);
    assert.equal(movePhase(plan, "enemies", 1), null);
  });
});

describe("editing extras", () => {
  it("adds a creatures phase named by key, with no number", () => {
    const next = addPhase(defaultPlan(), () => "abc");
    const added = next.at(-1);
    assert.equal(added.id, "abc");
    assert.equal(added.type, "creatures");
    assert.equal(added.name, null);
    assert.equal(added.nameKey, "SC_VENAERYS_INITIATIVE.Phase.New");
    assert.equal(added.icon, "fa-solid fa-flag");
    assert.equal(added.color, "#6fa35a");
    assert.ok(validatePlan(next));
  });

  it("deletes extras only", () => {
    assert.equal(deletePhase(defaultPlan(), "fast"), null);
    assert.deepEqual(ids(deletePhase(defaultPlan(), "boss")), ["epicBoss", "miniBoss", "fast", "enemies", "slow"]);
  });

  it("renames extras only and refuses an empty name", () => {
    assert.equal(renamePhase(defaultPlan(), "slow", "Lerdos"), null);
    assert.equal(renamePhase(defaultPlan(), "boss", "   "), null);
    assert.equal(renamePhase(defaultPlan(), "boss", "Tenente").find((p) => p.id === "boss").name, "Tenente");
  });

  it("restyles extras only, with a palette hex", () => {
    assert.equal(restylePhase(defaultPlan(), "fast", { color: "#000000" }), null);
    assert.equal(restylePhase(defaultPlan(), "boss", { color: "red" }), null);
    const next = restylePhase(defaultPlan(), "boss", { icon: "fa-solid fa-gem", color: "#9184d9" });
    assert.deepEqual(
      { icon: next[1].icon, color: next[1].color },
      { icon: "fa-solid fa-gem", color: "#9184d9" },
    );
  });

  it("flags a name the GM cleared", () => {
    const plan = defaultPlan();
    plan[1] = { ...plan[1], name: "" };
    assert.deepEqual(phasesWithoutName(plan), ["boss"]);
    assert.deepEqual(phasesWithoutName(defaultPlan()), []);
  });
});

describe("display name", () => {
  const localize = (key) => `<${key}>`;

  it("uses the GM's name, else the translated key", () => {
    const [epic] = defaultPlan();
    assert.equal(displayName(epic, localize), "<SC_VENAERYS_INITIATIVE.Phase.EpicBoss>");
    assert.equal(displayName({ ...epic, name: "Tenente" }, localize), "Tenente");
  });

  it("goes back to the translated key when the defaults are restored", () => {
    const renamed = renamePhase(defaultPlan(), "boss", "Tenente");
    assert.equal(displayName(renamed[1], localize), "Tenente");
    assert.equal(displayName(defaultPlan()[1], localize), "<SC_VENAERYS_INITIATIVE.Phase.Boss>");
  });
});
