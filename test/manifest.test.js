import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "module.json"), "utf8"));

describe("module manifest", () => {
  it("declares the socket and Foundry 13 to 14", () => {
    assert.equal(manifest.socket, true);
    assert.equal(manifest.compatibility.minimum, "13");
    assert.equal(manifest.compatibility.verified, "14");
  });

  it("points only at files that exist", async () => {
    const listed = [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map((l) => l.path)];
    for (const path of listed) await access(join(root, path));
    assert.deepEqual(manifest.languages.map((l) => l.lang).sort(), ["en", "pt-BR"]);
  });

  it("lists every stylesheet the module ships", async () => {
    const sheets = (await readdir(join(root, "styles"))).filter((f) => f.endsWith(".css")).map((f) => `styles/${f}`);
    assert.deepEqual([...manifest.styles].sort(), sheets.sort());
  });

  it("depends on no system and no other module", () => {
    assert.equal(manifest.relationships?.systems, undefined);
    assert.equal(manifest.relationships?.requires, undefined);
  });
});

describe("stylesheets", () => {
  /** Selectors of a stylesheet, outside @keyframes, with at-rule wrappers unwrapped. */
  function selectors(css) {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const out = [];
    for (const match of clean.matchAll(/([^{};]+)\{/g)) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith("@")) continue;
      out.push(...selector.split(",").map((s) => s.trim()));
    }
    return out;
  }

  it("scopes every selector under .sc-venaerys-initiative with svi-* classes and --svi-* variables", async () => {
    for (const file of manifest.styles) {
      const css = await readFile(join(root, file), "utf8");
      for (const selector of selectors(css)) {
        assert.ok(selector.startsWith(".sc-venaerys-initiative"), `${file}: ${selector}`);
        for (const cls of selector.matchAll(/\.([a-zA-Z][\w-]*)/g)) {
          assert.ok(cls[1] === "sc-venaerys-initiative" || cls[1].startsWith("svi-") || cls[1].startsWith("fa-") || ["active", "window-content"].includes(cls[1]), `${file}: class .${cls[1]}`);
        }
      }
      for (const variable of css.matchAll(/(--[\w-]+)\s*:/g)) {
        assert.ok(variable[1].startsWith("--svi-"), `${file}: ${variable[1]}`);
      }
    }
  });

  it("loads nothing from outside", async () => {
    for (const file of manifest.styles) {
      const css = await readFile(join(root, file), "utf8");
      assert.doesNotMatch(css, /url\(\s*["']?https?:/i, file);
      assert.doesNotMatch(css, /@import/i, file);
    }
  });
});
