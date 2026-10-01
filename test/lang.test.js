import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = async (name) => JSON.parse(await readFile(join(root, "lang", `${name}.json`), "utf8"));

/** Every key path of a nested catalog. */
function paths(node, prefix = "") {
  const out = new Set();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    out.add(path);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of paths(value, path)) out.add(nested);
    }
  }
  return out;
}

function flat(node, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flat(value, path, out);
    else out.set(path, value);
  }
  return out;
}

/** `{name}`-style placeholders: a translation that drops one breaks a sentence. */
const placeholders = (text) => new Set(String(text).match(/\{[a-zA-Z0-9_]+\}/g) ?? []);

async function files(dir, extensions) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path, extensions)));
    else if (extensions.some((ext) => entry.name.endsWith(ext))) out.push(path);
  }
  return out;
}

describe("localization catalogs", () => {
  it("keeps en and pt-BR structurally identical under one root", async () => {
    const [en, pt] = await Promise.all([read("en"), read("pt-BR")]);
    assert.deepEqual(Object.keys(en), ["SC_VENAERYS_INITIATIVE"]);
    assert.deepEqual(Object.keys(pt), ["SC_VENAERYS_INITIATIVE"]);
    const inEn = paths(en);
    const inPt = paths(pt);
    assert.deepEqual([...inEn].filter((k) => !inPt.has(k)), [], "missing from pt-BR");
    assert.deepEqual([...inPt].filter((k) => !inEn.has(k)), [], "missing from en");
  });

  /**
   * A key written twice in the same object is legal JSON and silently loses:
   * `JSON.parse` keeps the last one, so every other check reads the survivor.
   */
  it("has no key written twice inside one object", async () => {
    for (const name of ["en", "pt-BR"]) {
      const text = await readFile(join(root, "lang", `${name}.json`), "utf8");
      const stack = [];
      const seen = [new Set()];
      const duplicates = [];
      for (const line of text.split("\n")) {
        const key = line.match(/^\s*"([^"]+)"\s*:/)?.[1];
        if (key) {
          const scope = seen.at(-1);
          if (scope.has(key)) duplicates.push([...stack, key].join("."));
          scope.add(key);
          if (line.trimEnd().endsWith("{")) {
            stack.push(key);
            seen.push(new Set());
          }
          continue;
        }
        if (/^\s*\}/.test(line) && stack.length) {
          stack.pop();
          seen.pop();
        }
      }
      assert.deepEqual(duplicates, [], `duplicate keys in lang/${name}.json`);
    }
  });

  it("keeps the same placeholders in both languages", async () => {
    const [en, pt] = await Promise.all([read("en"), read("pt-BR")]);
    const ptFlat = flat(pt);
    const mismatched = [];
    for (const [path, value] of flat(en)) {
      const other = ptFlat.get(path);
      if (typeof value !== "string" || typeof other !== "string") continue;
      const a = placeholders(value);
      const b = placeholders(other);
      if (a.size !== b.size || [...a].some((token) => !b.has(token))) mismatched.push(path);
    }
    assert.deepEqual(mismatched, []);
  });

  it("has every key the scripts and templates name literally", async () => {
    const strings = flat(await read("en"));
    const sources = [...(await files(join(root, "scripts"), [".js"])), ...(await files(join(root, "templates"), [".hbs"]))];
    const missing = [];
    for (const file of sources) {
      const text = await readFile(file, "utf8");
      const literal = text.matchAll(/SC_VENAERYS_INITIATIVE\.([A-Za-z0-9_.]+)/g);
      const built = text.matchAll(/\$\{I18N_ROOT\}\.([A-Za-z0-9_.]+)/g);
      // Keys relative to the root, as files that build them with I18N_ROOT write them.
      const relative = text.includes("I18N_ROOT")
        ? text.matchAll(/["'`]((?:Tracker|Gm|Start|Config|Help|Notifications|Phase|Settings)\.[A-Za-z0-9_.]+)["'`]/g)
        : [];
      for (const match of [...literal, ...built, ...relative]) {
        const rest = match[1];
        if (rest.endsWith(".")) continue; // completed at runtime
        const key = `SC_VENAERYS_INITIATIVE.${rest}`;
        if (!strings.has(key)) missing.push(`${key} (${file.slice(root.length)})`);
      }
    }
    assert.deepEqual(missing, []);
  });
});
