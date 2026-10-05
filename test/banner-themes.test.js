import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BANNER_STYLES, bannerVariables, copyBannerTheme, normalizeBannerThemes, resolveBannerStyle } from "../scripts/helpers/banner-themes.js";
import { normalizeConsequence } from "../scripts/helpers/consequence-kinds.js";

describe("banner themes", () => {
  it("types the GM's themes, drops the ones without an id of their own and keeps each id once", () => {
    const themes = normalizeBannerThemes([
      { id: "mine", name: "  Mine  ", line: "#FF0000", background: "nope", corners: false },
      { id: "mine", name: "Twice" },
      { id: "hud", name: "Not a ready-made one" },
      { name: "No id" },
    ]);
    assert.deepEqual(themes, [{ id: "mine", name: "Mine", corners: false, line: "#ff0000", background: "#15181a", head: "#1b3a2e", title: "#e6e8ea", text: "#e6e8ea" }]);
    assert.deepEqual(normalizeBannerThemes("broken"), []);
  });

  it("copies a ready-made theme into one of the GM's own", () => {
    const copy = copyBannerTheme({ line: "#2ad4e6", background: "#122c3a", head: "#1f7b93", title: "#eafcff", text: "#cfeef5", corners: true }, { id: "banner-1", name: "HUD (copy)" });
    assert.deepEqual([copy.id, copy.name, copy.line, copy.corners], ["banner-1", "HUD (copy)", "#2ad4e6", true]);
  });

  it("draws a ready-made theme by class, the GM's by variables, and a missing one as the module's theme", () => {
    const mine = normalizeBannerThemes([{ id: "mine", line: "#ff0000", corners: false }]);
    assert.deepEqual(resolveBannerStyle("hud", mine), { preset: "hud", variables: null });
    const own = resolveBannerStyle("mine", mine);
    assert.equal(own.preset, null);
    assert.deepEqual([own.variables["--svi-banner-line"], own.variables["--svi-banner-corner"]], ["#ff0000", "transparent"]);
    assert.equal(bannerVariables({ ...mine[0], corners: true })["--svi-banner-corner"], "#ff0000");
    assert.deepEqual(resolveBannerStyle("deleted", mine), { preset: "themed", variables: null });
    assert.ok(BANNER_STYLES.includes("themed"));
  });

  it("keeps a message's banner theme by id, the module's theme when there is none", () => {
    assert.equal(normalizeConsequence({ id: "m", kind: "screenMessage", params: { style: "mine" } }).params.style, "mine");
    assert.equal(normalizeConsequence({ id: "m", kind: "screenMessage", params: { style: "" } }).params.style, "themed");
    assert.equal(normalizeConsequence({ id: "m", kind: "screenMessage" }).params.seconds, 6);
  });
});
