import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { DEFAULT_PHASES, defaultPlan } from "../scripts/constants/default-phases.js";
import { SETTINGS_SCHEMA, SETTING_SECTIONS, SETTING_TABS, coerceSetting, schemaEntry } from "../scripts/constants/settings-schema.js";

const catalog = async (name) =>
  JSON.parse(await readFile(new URL(`../lang/${name}.json`, import.meta.url), "utf8")).SC_VENAERYS_INITIATIVE;
const lookup = (root, path) => path.split(".").reduce((node, key) => node?.[key], root);

describe("settings schema", () => {
  it("has unique keys, known tabs and known sections", () => {
    const keys = SETTINGS_SCHEMA.map((entry) => entry.key);
    assert.equal(new Set(keys).size, keys.length);
    for (const entry of SETTINGS_SCHEMA) {
      assert.ok(entry.tab === null || SETTING_TABS.some((tab) => tab.id === entry.tab && tab.settings), entry.key);
      assert.ok(entry.section === null || SETTING_SECTIONS.includes(entry.section), entry.key);
    }
  });

  it("lays the screen out in the suite's tabs, with only the client tab for players", () => {
    assert.deepEqual(SETTING_TABS.map((tab) => tab.id), ["world", "appearance", "phases", "client", "help"]);
    assert.deepEqual(SETTING_TABS.filter((tab) => !tab.gm).map((tab) => tab.id), ["client"]);
    for (const entry of SETTINGS_SCHEMA.filter((e) => e.tab)) {
      const tab = SETTING_TABS.find((t) => t.id === entry.tab);
      assert.equal(tab.gm, entry.scope === "world", `${entry.key} sits on a tab its scope can see`);
    }
  });

  it("has the scopes and defaults of the specification", () => {
    const expected = {
      enabledByDefault: ["world", true],
      phaseTemplate: ["world", DEFAULT_PHASES],
      defaultDc: ["world", 15],
      showDcToPlayers: ["world", false],
      autoAdvance: ["world", true],
      openOnStart: ["client", true],
      theme: ["world", "ember"],
      dcSource: ["world", "manual"],
      dcBase: ["world", 10],
      natural20: ["world", "autoSuccess"],
      natural1: ["world", "autoFail"],
      suggestFromSheet: ["world", true],
    };
    assert.deepEqual(SETTINGS_SCHEMA.map((e) => e.key).sort(), Object.keys(expected).sort());
    for (const [key, [scope, value]] of Object.entries(expected)) {
      assert.equal(schemaEntry(key).scope, scope, key);
      assert.deepEqual(schemaEntry(key).default, value, key);
    }
    assert.deepEqual(schemaEntry("defaultDc").range, { min: 1, max: 40, step: 1 });
    assert.deepEqual(schemaEntry("dcBase").range, { min: 0, max: 30, step: 1 });
    assert.deepEqual(schemaEntry("dcSource").choices, ["manual", "baseCr"]);
    assert.deepEqual(schemaEntry("natural20").choices, ["none", "autoSuccess"]);
    assert.deepEqual(schemaEntry("natural1").choices, ["none", "autoFail"]);
  });

  it("labels every choice of the generated select rows in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const root = await catalog(lang);
      for (const entry of SETTINGS_SCHEMA.filter((e) => e.type === "choice" && e.tab !== "appearance")) {
        for (const choice of entry.choices) {
          assert.equal(typeof lookup(root, `Settings.${entry.key}.Choices.${choice}`), "string", `${lang} ${entry.key}.${choice}`);
        }
      }
    }
  });

  it("gives every setting a name and a hint in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const root = await catalog(lang);
      for (const entry of SETTINGS_SCHEMA) {
        assert.equal(typeof lookup(root, `Settings.${entry.key}.Name`), "string", `${lang} ${entry.key}`);
        assert.equal(typeof lookup(root, `Settings.${entry.key}.Hint`), "string", `${lang} ${entry.key}`);
      }
    }
  });
});

describe("coerceSetting", () => {
  const dc = schemaEntry("defaultDc");

  it("keeps the DC between 1 and 40 and rejects garbage", () => {
    assert.equal(coerceSetting(dc, "50"), 40);
    assert.equal(coerceSetting(dc, 0), 1);
    assert.equal(coerceSetting(dc, "abc"), 15);
    assert.equal(coerceSetting(dc, ""), 15);
    assert.equal(coerceSetting(dc, "17"), 17);
  });

  it("keeps a choice inside its list", () => {
    assert.equal(coerceSetting(schemaEntry("dcSource"), "baseCr"), "baseCr");
    assert.equal(coerceSetting(schemaEntry("dcSource"), "nonsense"), "manual");
    assert.equal(coerceSetting(schemaEntry("natural1"), "autoSuccess"), "autoFail");
  });

  it("reads checkboxes", () => {
    assert.equal(coerceSetting({ type: "boolean" }, undefined), false);
    assert.equal(coerceSetting({ type: "boolean" }, "on"), true);
  });

  it("turns a corrupted phase template into the default one, with no translated name stored", () => {
    const template = schemaEntry("phaseTemplate");
    const coerced = coerceSetting(template, [{ broken: true }]);
    assert.deepEqual(coerced, defaultPlan());
    assert.ok(coerced.every((phase) => phase.name === null));
  });
});
