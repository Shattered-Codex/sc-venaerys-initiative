import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { actingIndexes } from "../scripts/helpers/phase-progression.js";
import PhaseTurnMarkers from "../scripts/services/PhaseTurnMarkers.js";
import { combatView, enemy, player } from "./helpers/combat-view.js";
import { fakeCombat, fakeCombatant, installGame } from "./helpers/fake-combat.js";

describe("who shows the turn marker", () => {
  it("is every member of the current phase still acting: not done, not defeated", () => {
    const view = combatView({ round: 2, on: "bia", combatants: [player("ana", "fast", { done: 2 }), player("bia", "fast"), player("caio", "fast", { isDefeated: true }), enemy("gob")] });
    assert.deepEqual(actingIndexes(view), [1]);
  });

  it("reads the moved mark in the movement half and nobody before the start", () => {
    const moving = combatView({ round: 2, on: "bia", split: "players", combatants: [player("ana", "fast", { moved: 2 }), player("bia", "fast")] });
    assert.deepEqual(actingIndexes(moving), [1]);
    assert.deepEqual(actingIndexes(combatView({ round: 0, combatants: [player("ana", "fast")] })), []);
  });
});

describe("PhaseTurnMarkers", () => {
  /** A canvas token with what `_refreshTurnMarker` touches. */
  function fakeToken(id) {
    return {
      id,
      document: { turnMarker: { mode: 1 } },
      turnMarker: null,
      flags: [],
      renderFlags: { set(flags) { this.owner.flags.push(flags); } },
      addChildAt(child) { return child; },
    };
  }

  function setup({ enabled = true, phased = true } = {}) {
    installGame();
    const p = (id, flags) => fakeCombatant({ id, initiative: 15, hasToken: true, flags: { side: "players", phase: "fast", ...flags } });
    const combat = fakeCombat({ round: 2, phased, combatants: [p("ana", { done: 2 }), p("bia", {}), p("caio", {})] });
    combat.turn = 2;
    globalThis.game.combat = combat;
    const tokens = new Map(["token-ana", "token-bia", "token-caio"].map((id) => [id, fakeToken(id)]));
    for (const token of tokens.values()) token.renderFlags.owner = token;
    const turnMarkers = new Set();
    globalThis.canvas = { ready: true, tokens: { get: (id) => tokens.get(id), turnMarkers } };
    globalThis.CONFIG.Combat.settings = { turnMarker: { enabled: true } };
    globalThis.CONST = { TOKEN_TURN_MARKER_MODES: { DISABLED: 0 } };
    globalThis.foundry.canvas = { placeables: { tokens: { TokenTurnMarker: class { draw() { this.drawn = true; } destroy() { this.destroyed = true; } } } } };
    const markers = new PhaseTurnMarkers({ adapter: null, enabled: () => enabled });
    return { combat, tokens, turnMarkers, markers };
  }

  it("marks every member still acting of a phased combat, not only Foundry's current combatant", () => {
    const { tokens, turnMarkers, markers } = setup();
    const core = () => assert.fail("the core rule must not run in a phased combat");
    for (const token of tokens.values()) markers.refreshToken(token, core, []);
    assert.deepEqual([...turnMarkers].map((t) => t.id).sort(), ["token-bia", "token-caio"]);
    assert.equal(tokens.get("token-ana").turnMarker, null);
    assert.equal(tokens.get("token-bia").turnMarker.drawn, true);
  });

  it("hides a turn marker from players when the combatant is hidden", () => {
    const { combat, tokens, turnMarkers, markers } = setup();
    game.user.isGM = false;
    combat.combatants.get("bia").visible = false;
    for (const token of tokens.values()) markers.refreshToken(token, () => {}, []);
    assert.deepEqual([...turnMarkers].map((token) => token.id), ["token-caio"]);
    assert.equal(tokens.get("token-bia").turnMarker, null);
  });

  it("coalesces combatant changes and updates visibility on the next frame", () => {
    const { combat, tokens, markers } = setup();
    game.user.isGM = false;
    markers.refreshToken(tokens.get("token-bia"), () => {}, []);
    let draws = 0;
    let frame;
    markers.scheduler.requestFrame = (callback) => { draws += 1; frame = callback; };
    combat.combatants.get("bia").visible = false;
    markers.scheduleRefresh();
    markers.scheduleRefresh();
    assert.equal(draws, 1);
    frame();
    assert.ok(tokens.get("token-bia").flags.some((flags) => flags.refreshTurnMarker));
    markers.refreshToken(tokens.get("token-bia"), () => {}, []);
    assert.equal(tokens.get("token-bia").turnMarker, null);
  });

  it("takes the marker off a member who marks done, after the next change", () => {
    const { combat, tokens, turnMarkers, markers } = setup();
    for (const token of tokens.values()) markers.refreshToken(token, () => {}, []);
    combat.combatants.get("bia").flags["sc-venaerys-initiative"].done = 2;
    markers.refresh(combat);
    assert.ok(tokens.get("token-bia").flags.some((f) => f.refreshTurnMarker));
    markers.refreshToken(tokens.get("token-bia"), () => {}, []);
    assert.equal(tokens.get("token-bia").turnMarker, null);
    assert.equal(turnMarkers.has(tokens.get("token-bia")), false);
  });

  it("leaves the core's rule alone without phases or with the setting off", () => {
    for (const options of [{ phased: false }, { enabled: false }]) {
      const { tokens, markers } = setup(options);
      let core = 0;
      markers.refreshToken(tokens.get("token-bia"), () => (core += 1), []);
      assert.equal(core, 1, JSON.stringify(options));
    }
  });
});
