import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultPlan } from "../scripts/constants/default-phases.js";
import { exportFileName, exportPayload, mergeBannerThemes, parseImport } from "../scripts/helpers/config-transfer.js";

describe("exporting and importing the configuration", () => {
  const banners = [{ id: "mine", name: "Mine", corners: true, line: "#ff0000", background: "#000000", head: "#111111", title: "#ffffff", text: "#eeeeee" }];

  it("round-trips the phases and the banner themes", () => {
    const plan = defaultPlan();
    assert.deepEqual(parseImport(exportPayload("phases", plan), "phases").data, plan);
    assert.deepEqual(parseImport(exportPayload("banners", banners), "banners").data, banners);
    assert.equal(exportFileName("phases"), "sc-venaerys-initiative-phases.json");
  });

  it("refuses what is not JSON, not this module's, of the other kind, or not valid", () => {
    assert.deepEqual(parseImport("{nope", "phases"), { error: "NotJson" });
    assert.deepEqual(parseImport(JSON.stringify({ module: "other", kind: "phases", data: [] }), "phases"), { error: "WrongFile" });
    assert.deepEqual(parseImport(exportPayload("banners", banners), "phases"), { error: "WrongKind" });
    assert.deepEqual(parseImport(exportPayload("phases", defaultPlan().slice(1, 3)), "phases"), { error: "Invalid" });
    assert.deepEqual(parseImport(exportPayload("banners", [{ name: "no id" }]), "banners"), { error: "Invalid" });
  });

  it("drops unknown actions of an imported phase and joins imported banner themes to the GM's own", () => {
    const plan = defaultPlan();
    plan[0].onEnter = [{ kind: "nope" }, { id: "s", kind: "sound", params: { src: "a.ogg" } }];
    assert.deepEqual(parseImport(exportPayload("phases", plan), "phases").data[0].onEnter.map((row) => row.kind), ["sound"]);
    const merged = mergeBannerThemes([{ id: "mine", name: "Old" }, { id: "other", name: "Other" }], banners);
    assert.deepEqual(merged.map((theme) => [theme.id, theme.name]), [["other", "Other"], ["mine", "Mine"]]);
  });
});
