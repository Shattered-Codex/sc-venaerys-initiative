import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PHASE_COLORS, PHASE_COLOR_NAMES, PHASE_ICONS, iconName } from "../scripts/constants/module-constants.js";

/** Every control the module draws has a name a screen reader can say, in the user's language. */

const root = fileURLToPath(new URL("..", import.meta.url));

async function templates(dir = join(root, "templates")) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await templates(path)));
    else if (entry.name.endsWith(".hbs")) out.push(path);
  }
  return out;
}

const catalog = async (lang) => JSON.parse(await readFile(join(root, `lang/${lang}.json`), "utf8")).SC_VENAERYS_INITIATIVE;

describe("accessible names", () => {
  it("gives every button, select, input and summary a name: an aria-label, a label, or visible localized text", async () => {
    const missing = [];
    for (const file of await templates()) {
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/<(button|select|input|textarea|summary)\b([^>]*)>([\s\S]*?)(?=<\/\1>|$)/g)) {
        const [, tag, attrs, body] = match;
        if (/type="hidden"/.test(attrs) || /\binert\b/.test(attrs)) continue;
        let named = /aria-label(ledby)?=/.test(attrs);
        if (!named && (tag === "button" || tag === "summary")) named = /localize|\{\{\s*[\w.]*label|<span/.test(body.slice(0, 600));
        if (!named && tag !== "button" && tag !== "summary") {
          const id = attrs.match(/\bid="([^"]+)"/)?.[1];
          named = !!id && text.includes(`for="${id}"`);
        }
        if (!named) missing.push(`${relative(root, file)}: <${tag}${attrs.slice(0, 80)}`);
      }
    }
    assert.deepEqual(missing, []);
  });

  it("never names a control by a raw value such as an icon class or a hex color", async () => {
    for (const file of await templates()) {
      const text = await readFile(file, "utf8");
      assert.doesNotMatch(text, /aria-label="\{\{\s*(cls|hex|icon|color)\s*\}\}"/, relative(root, file));
    }
  });

  it("shows a done mark from the control's own state, never from a module root around it", async () => {
    const css = await readFile(join(root, "styles/combat-tracker.css"), "utf8");
    // The phase section is a module root around every row and is never done: an ancestor rule would hide "Done" for good.
    assert.doesNotMatch(css, /\.sc-venaerys-initiative(:not\(\.svi-done\)|\.svi-done)\s+\.svi-when-(done|todo)/);
    assert.match(css, /\.svi-done-btn\[aria-pressed="true"\] \.svi-when-todo/);
    assert.match(css, /\.svi-done-btn:not\(\[aria-pressed="true"\]\) \.svi-when-done/);
  });

  it("names every icon and color of the phase pickers in both languages", async () => {
    for (const lang of ["en", "pt-BR"]) {
      const phases = (await catalog(lang)).Config.Phases;
      for (const cls of PHASE_ICONS) assert.equal(typeof phases.Icons?.[iconName(cls)], "string", `${lang} icon ${cls}`);
      for (const hex of PHASE_COLORS) assert.equal(typeof phases.Colors?.[PHASE_COLOR_NAMES[hex]], "string", `${lang} color ${hex}`);
    }
  });
});
