import { actingIndexes } from "../helpers/phase-progression.js";
import CombatSnapshot from "./CombatSnapshot.js";
import ErrorGuard from "./ErrorGuard.js";
import FrameScheduler from "./FrameScheduler.js";

/**
 * Foundry draws its turn marker under the token of `combat.combatant` alone.
 * In a phased combat everyone in the current phase acts at once, so every
 * member still acting gets the marker, and it leaves each token as that
 * member marks done (or moved, in the movement half). Only the drawing
 * changes: the pointer, the turn and the turn events stay Foundry's. The
 * core decides it in `Token#_refreshTurnMarker`, the same body in v13 and
 * v14, so the wrapper repeats that body with the phase's rule; anywhere else
 * (no phases, not started, the setting off) the core's own method runs.
 */
export default class PhaseTurnMarkers {
  /** `{combat, tokens}`: the acting tokens of the viewed combat, until the next change. */
  #acting = null;
  #dirtyTokens = new Set();

  constructor({ adapter, enabled }) {
    this.adapter = adapter;
    this.enabled = enabled;
    this.scheduler = new FrameScheduler(() => this.refresh());
  }

  /** At `setup`, on the final Token and Combat classes. */
  install() {
    const markers = this;
    const tokenProto = CONFIG.Token?.objectClass?.prototype;
    const refreshToken = tokenProto?._refreshTurnMarker;
    if (typeof refreshToken === "function") {
      tokenProto._refreshTurnMarker = ErrorGuard.wrap("turn-marker", function phaseTurnMarker(...args) {
        return markers.refreshToken(this, refreshToken, args);
      }, refreshToken);
    }
    const combatProto = CONFIG.Combat?.documentClass?.prototype;
    const updateMarkers = combatProto?._updateTurnMarkers;
    if (typeof updateMarkers === "function") {
      combatProto._updateTurnMarkers = ErrorGuard.wrap("turn-markers", function phaseTurnMarkers(...args) {
        const result = updateMarkers.apply(this, args);
        markers.refresh(this);
        return result;
      }, updateMarkers);
    }
  }

  /** Token ids of the members still acting in the viewed phased combat, or null where the core's rule applies. */
  actingTokens(combat) {
    if (!combat || combat !== game.combat || !combat.started || !this.enabled() || !CombatSnapshot.isPhased(combat)) return null;
    if (this.#acting?.combat === combat) return this.#acting.tokens;
    const view = CombatSnapshot.from(combat, this.adapter);
    // A player must not see a turn marker for a combatant the core tracker hides.
    const tokens = new Set(actingIndexes(view)
      .filter((i) => game.user.isGM || view.combatants[i].visible)
      .map((i) => combat.turns[i]?.tokenId).filter(Boolean));
    this.#acting = { combat, tokens };
    return tokens;
  }

  /** After a change of the combat, its marks or the setting: the markers that come or go are redrawn. */
  refresh(combat = game.combat) {
    const before = new Set([...this.#dirtyTokens, ...(this.#acting?.tokens ?? [])]);
    this.#dirtyTokens.clear();
    this.#acting = null;
    if (!globalThis.canvas?.ready) return;
    const after = this.actingTokens(combat) ?? new Set();
    const ids = new Set([...before, ...after, ...Array.from(canvas.tokens.turnMarkers ?? [], (token) => token.id)]);
    for (const id of ids) canvas.tokens.get(id)?.renderFlags.set({ refreshTurnMarker: true });
  }

  /** Invalidate immediately, then coalesce bursts of document hooks into one canvas update. */
  scheduleRefresh() {
    for (const id of this.#acting?.tokens ?? []) this.#dirtyTokens.add(id);
    this.#acting = null;
    this.scheduler.schedule();
  }

  /** The core's `_refreshTurnMarker`, with "is this token's turn" read from the phase. */
  refreshToken(token, original, args) {
    const acting = this.actingTokens(game.combat);
    if (!acting) return original.apply(token, args);
    const { turnMarker } = token.document;
    const markersEnabled = CONFIG.Combat.settings.turnMarker.enabled && turnMarker.mode !== CONST.TOKEN_TURN_MARKER_MODES.DISABLED;
    if (markersEnabled && acting.has(token.id)) {
      if (!token.turnMarker) token.turnMarker = token.addChildAt(new foundry.canvas.placeables.tokens.TokenTurnMarker(token), 0);
      canvas.tokens.turnMarkers.add(token);
      token.turnMarker.draw();
    } else if (token.turnMarker) {
      canvas.tokens.turnMarkers.delete(token);
      token.turnMarker.destroy();
      token.turnMarker = null;
    }
    return undefined;
  }
}
