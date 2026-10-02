import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/** Structural rules of the module, checked on the source text. */

const root = fileURLToPath(new URL("..", import.meta.url));

async function files(dir, extensions) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out.sort();
}

/** Source without comments and string contents (template expressions stay), so prose never trips a rule. */
function code(text) {
  const keepExpressions = (literal) =>
    literal
      .slice(1, -1)
      .split(/(\$\{[^}]*\})/)
      .map((part) => (part.startsWith("${") ? part : ""))
      .join(" ");
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""')
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, keepExpressions);
}

const scripts = await files(join(root, "scripts"), [".js"]);
const sources = await Promise.all(scripts.map(async (file) => ({ file, rel: relative(root, file), text: await readFile(file, "utf8") })));
const under = (folder) => sources.filter((s) => s.rel.startsWith(`scripts/${folder}/`));

describe("architecture", () => {
  it("keeps helpers free of Foundry globals", () => {
    for (const { rel, text } of under("helpers")) {
      assert.doesNotMatch(code(text), /(?<![\w.$])(game|canvas|ui|foundry|Hooks|CONFIG)\s*(\?\.|\.|\[)/, rel);
    }
  });

  it("reads actor.system and CONFIG.DND5E only inside the system adapters", () => {
    for (const { rel, text } of sources) {
      if (rel.startsWith("scripts/services/adapters/")) continue;
      assert.doesNotMatch(text, /actor\??\.system|CONFIG\.DND5E/, rel);
    }
  });

  it("keeps one exported class per file in services and applications, named after the file", () => {
    for (const { rel, text } of [...under("services"), ...under("applications")]) {
      // Anonymous subclasses built at runtime (`class extends Base`) are part of their file's class.
      const classes = [...code(text).matchAll(/\bclass\s+(?!extends\b)([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
      assert.deepEqual(classes, [basename(rel, ".js")], rel);
      assert.match(text, new RegExp(`export default class ${basename(rel, ".js")}\\b`), rel);
    }
  });

  it("uses no libWrapper, no socketlib and no remote resource", async () => {
    const shipped = [...scripts, ...(await files(join(root, "templates"), [".hbs"])), ...(await files(join(root, "styles"), [".css"]))];
    for (const file of shipped) {
      const text = await readFile(file, "utf8");
      assert.doesNotMatch(text, /libWrapper|socketlib|https?:\/\//, relative(root, file));
    }
  });

  it("registers settings and menus only in register-settings.js", () => {
    for (const { rel, text } of sources) {
      if (rel === "scripts/hooks/register-settings.js") continue;
      assert.doesNotMatch(code(text), /settings\.(register|registerMenu)\s*\(/, rel);
    }
  });

  it("registers hooks only through ErrorGuard and the entry point", () => {
    for (const { rel, text } of sources) {
      if (rel === "scripts/services/ErrorGuard.js" || rel === "scripts/module.js") continue;
      assert.doesNotMatch(code(text), /Hooks\.(on|once)\s*\(/, rel);
    }
  });

  it("depends on no other module: only its own imports, other modules only by optional detection", () => {
    for (const { file, rel, text } of sources) {
      for (const match of text.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
        const target = resolve(dirname(file), match[1]);
        assert.ok(match[1].startsWith("."), `${rel}: ${match[1]}`);
        assert.ok(target.startsWith(join(root, "scripts")), `${rel}: ${match[1]}`);
      }
      assert.doesNotMatch(code(text), /(?<!globalThis\.)\bMidiQOL\b/, rel);
      assert.doesNotMatch(code(text), /globalThis\.MidiQOL\.(?!\?)/, rel);
    }
  });
});
