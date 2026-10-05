import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { beforeEach, describe, it } from "node:test";
import { DEFAULT_THEME, LEGACY_THEMES, THEMES, THEME_FAMILIES, customThemeVariables, normalizeColor, normalizeTheme } from "../scripts/helpers/themes.js";
import ThemeApplier from "../scripts/services/ThemeApplier.js";
import { installGame } from "./helpers/fake-combat.js";

const css = await readFile(new URL("../styles/themes.css", import.meta.url), "utf8");
const catalog = async (lang) => JSON.parse(await readFile(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")).SC_VENAERYS_INITIATIVE;

describe("theme catalog", () => {
  it("defaults to verdant, files the suite's sixteen themes and the custom one once and reads an unknown value as the default", () => {
    assert.equal(DEFAULT_THEME, "verdant");
    assert.equal(THEMES.length, 17);
    assert.equal(normalizeTheme("custom"), "custom");
    assert.equal(new Set(THEMES).size, THEMES.length);
    assert.equal(normalizeTheme("nope"), "verdant");
    assert.equal(normalizeTheme("neon"), "neon");
    assert.equal(normalizeTheme("parchment"), "parchment");
  });

  it("derives the custom theme's palette from three colors, and reads a broken color as the default", () => {
    assert.equal(normalizeColor(" #AABBCC ", "#000000"), "#aabbcc");
    assert.equal(normalizeColor("red", "#000000"), "#000000");
    const dark = customThemeVariables({ accent: "#ffcc00", background: "#000000", text: "#ffffff" });
    assert.deepEqual([dark["--svi-accent"], dark["--svi-bg"], dark["--svi-text"], dark["--svi-accent-soft"]], ["#ffcc00", "#000000", "#ffffff", "#ffcc0022"]);
    assert.equal(dark["--svi-bg-2"], "#141414");
    assert.equal(dark["--svi-text-dim"], "#a6a6a6");
    // A bright accent takes dark text over it, a dark accent light text.
    assert.equal(dark["--svi-text-on-acc"], "#261f00");
    assert.equal(customThemeVariables({ accent: "#102040" })["--svi-text-on-acc"], "#ecedf0");
    assert.equal(customThemeVariables({ accent: "nope" })["--svi-accent"], "#1fa971");
    for (const [name, value] of Object.entries(dark)) assert.match(`${name}:${value}`, /^--svi-[\w-]+:#[0-9a-f]{6,8}$/);
  });

  it("has a stylesheet block for every theme but the base one, and only --svi-* inside", () => {
    for (const theme of [...THEMES.filter((t) => t !== DEFAULT_THEME), ...LEGACY_THEMES]) {
      assert.match(css, new RegExp(`\\[data-theme="${theme}"\\]`), theme);
    }
    for (const variable of css.matchAll(/(--[\w-]+)\s*:/g)) assert.ok(variable[1].startsWith("--svi-"), variable[1]);
  });

  it("names every theme and family in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const root = await catalog(lang);
      for (const theme of THEMES) assert.equal(typeof root.Theme[theme], "string", `${lang} ${theme}`);
      for (const theme of LEGACY_THEMES) assert.equal(typeof root.Theme[theme], "string", `${lang} ${theme}`);
      for (const family of THEME_FAMILIES) assert.equal(typeof root.ThemeFamily[family.id], "string", `${lang} ${family.id}`);
      assert.equal(typeof root.ThemeFamily.Legacy, "string", `${lang} legacy family`);
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

  it("keeps a previously saved theme on the module's roots", () => {
    game.settings.get = (_module, key) => (key === "theme" ? "neon" : undefined);
    ThemeApplier.refresh();
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["neon", "neon"]);
  });

  it("previews without saving and puts the saved theme back", async () => {
    ThemeApplier.preview("light");
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["light", "light"]);
    assert.equal(game.settings.get("x", "theme"), "moss");
    ThemeApplier.endPreview();
    assert.deepEqual(elements.map((e) => e.dataset.theme), ["moss", "moss"]);
    assert.equal(ThemeApplier.previewing, false);
  });

  it("previews other custom colors and goes back to the saved ones when they are restored", () => {
    const style = { textContent: "" };
    globalThis.document = { querySelectorAll: () => elements, head: { querySelector: () => style } };
    ThemeApplier.previewColors({ accent: "#ff0000", background: "#000000", text: "#ffffff" });
    assert.match(style.textContent, /--svi-accent:#ff0000/);
    assert.equal(ThemeApplier.previewing, true);
    ThemeApplier.previewColors(null);
    assert.match(style.textContent, /--svi-accent:#1fa971/);
    assert.equal(ThemeApplier.previewing, false);
  });
});
