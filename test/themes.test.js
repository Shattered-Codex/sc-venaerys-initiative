import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_THEME, THEMES, THEME_FAMILIES, normalizeTheme } from "../scripts/helpers/themes.js";
import ThemeApplier from "../scripts/services/ThemeApplier.js";
import { installGame } from "./helpers/fake-combat.js";

const css = await readFile(new URL("../styles/themes.css", import.meta.url), "utf8");
const catalog = async (lang) => JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")).SC_VENAERYS_INITIATIVE;

describe("theme catalog", () => {
  it("defaults to ember, files every theme once and reads an unknown value as the default", () => {
    assert.equal(DEFAULT_THEME, "ember");
    assert.equal(new Set(THEMES).size, THEMES.length);
    assert.equal(normalizeTheme("nope"), "ember");
    assert.equal(normalizeTheme("parchment"), "parchment");
  });

  it("has a stylesheet block for every theme but the base one, and only --svi-* inside", () => {
    for (const theme of THEMES.filter((t) => t !== DEFAULT_THEME)) {
      assert.match(css, new RegExp(`\\[data-theme="${theme}"\\]`), theme);
    }
    for (const variable of css.matchAll(/(--[\w-]+)\s*:/g)) assert.ok(variable[1].startsWith("--svi-"), variable[1]);
  });

  it("names every theme and family in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const root = await catalog(lang);
      for (const theme of THEMES) assert.equal(typeof root.Theme[theme], "string", `${lang} ${theme}`);
      for (const family of THEME_FAMILIES) assert.equal(typeof root.ThemeFamily[family.id], "string", `${lang} ${family.id}`);
    }
  });
});

describe("ThemeApplier", () => {
  const roots = () => [{ dataset: {} }, { dataset: {} }];
  let elements;
  beforeEach(() => {
    installGame({ settings: { theme: "moss" } });
    elements = roots();
    globalThis.document = { querySelectorAll: () => elements };
  });

  it("stamps the saved theme on the module's roots", () => {
    ThemeApplier.refresh();
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["moss", "moss"]);
  });

  it("previews without saving and puts the saved theme back", async () => {
    ThemeApplier.preview("light");
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["light", "light"]);
    assert.equal(game.settings.get("x", "theme"), "moss");
    ThemeApplier.endPreview();
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["moss", "moss"]);
    assert.equal(ThemeApplier.previewing, false);
  });
});
