import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { COMMUNITY_LINKS, MODULE_ID } from "../scripts/constants/module-constants.js";
import CommunityLinks from "../scripts/services/CommunityLinks.js";

const manifest = JSON.parse(await readFile(new URL("../module.json", import.meta.url), "utf8"));

describe("community links", () => {
  it("has an address in the manifest for the wiki of this module, Patreon and Discord", () => {
    const links = manifest.flags[MODULE_ID].links;
    assert.deepEqual(COMMUNITY_LINKS.map((link) => link.id), ["wiki", "patreon", "discord"]);
    for (const { id } of COMMUNITY_LINKS) assert.match(links[id], /^https:\/\//, id);
    assert.ok(links.wiki.endsWith(`/modules/${MODULE_ID}`));
    assert.ok(links.patreon.includes(`utm_source=${MODULE_ID}`));
  });

  it("labels each link and leaves out one with no address", () => {
    globalThis.game = { modules: { get: () => ({ flags: { [MODULE_ID]: { links: { wiki: "w", discord: "d" } } } }) } };
    const links = CommunityLinks.links((key) => key);
    assert.deepEqual(links.map((link) => [link.id, link.url]), [["wiki", "w"], ["discord", "d"]]);
    assert.equal(links[0].label, "SC_VENAERYS_INITIATIVE.Links.wiki.Label");
  });
});
