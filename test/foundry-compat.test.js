import assert from "node:assert/strict";
import { describe, it } from "node:test";
import FoundryCompat from "../scripts/services/FoundryCompat.js";

describe("FoundryCompat.contextEntry", () => {
  it("carries the v13 and the v14 shapes, both reaching the same row", () => {
    const clicked = [];
    globalThis.game = { release: { generation: 13 } };
    const entry = FoundryCompat.contextEntry({ label: "Move", icon: "fa-solid fa-layer-group", visible: (li) => li.ok, onClick: (li) => clicked.push(li) });
    assert.equal(entry.name, "Move");
    assert.equal(entry.label, "Move");
    assert.equal(entry.icon, '<i class="fa-solid fa-layer-group"></i>');
    assert.equal(entry.condition({ ok: true }), true);
    assert.equal(entry.visible({ ok: false }), false);
    const li = { id: "row" };
    entry.callback(li);
    entry.onClick({ type: "click" }, li);
    assert.deepEqual(clicked, [li, li]);
    globalThis.game.release.generation = 14;
    assert.equal(FoundryCompat.contextEntry({ label: "Move", icon: "fa-solid fa-layer-group", onClick: () => {} }).icon, "fa-solid fa-layer-group");
  });
});
