import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { COMMUNITY_LINKS } from "../scripts/constants/community-links.js";
import { MODULE_ID } from "../scripts/constants/module-constants.js";
import CommunityLinks from "../scripts/services/CommunityLinks.js";

describe("community links", () => {
  it("points at the wiki of this module, Patreon and Discord", () => {
    assert.deepEqual(COMMUNITY_LINKS.map((link) => link.id), ["wiki", "patreon", "discord"]);
    for (const link of COMMUNITY_LINKS) assert.match(link.url, /^https:\/\//, link.id);
    const [wiki, patreon] = COMMUNITY_LINKS;
    assert.ok(wiki.url.endsWith(`/modules/${MODULE_ID}`));
    assert.ok(patreon.url.includes(`utm_source=${MODULE_ID}`));
  });

  it("labels each link in the client's language", () => {
    const links = CommunityLinks.links((key) => key);
    assert.deepEqual(links.map((link) => link.label), ["wiki", "patreon", "discord"].map((id) => `SC_VENAERYS_INITIATIVE.Links.${id}.Label`));
    assert.equal(links[0].url, COMMUNITY_LINKS[0].url);
  });
});
