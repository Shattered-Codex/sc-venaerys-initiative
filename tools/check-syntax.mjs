import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * `node --check file.js` decides CommonJS-or-module from the nearest
 * package.json, and under CommonJS it silently passes things that are errors
 * in a module — a duplicate `const` in the same block among them, which once
 * shipped broken and took the whole module graph down with it. Feeding the
 * source through stdin with `--input-type=module` leaves nothing to infer.
 */
async function check(file) {
  const source = await readFile(file, "utf8");
  const child = run(process.execPath, ["--input-type=module", "--check"]);
  child.child.stdin.end(source);
  await child;
}

/** Every `.js` file the module ships, in stable order. */
async function scripts(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await scripts(path)));
    else if (entry.name.endsWith(".js")) out.push(path);
  }
  return out.sort();
}

const files = await scripts(join(root, "scripts"));
const broken = [];
for (const file of files) {
  try {
    await check(file);
  } catch (error) {
    broken.push(`${relative(root, file)}\n${error.stderr?.trim() ?? error.message}`);
  }
}

if (broken.length) {
  console.error(broken.join("\n\n"));
  console.error(`\n${broken.length} of ${files.length} file(s) failed to parse.`);
  process.exit(1);
}
console.log(`${files.length} script(s) parsed cleanly.`);
