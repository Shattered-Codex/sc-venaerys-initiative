import SystemAdapter from "./SystemAdapter.js";

/**
 * dnd5e: enemies show their initiative score, so the system groups identical
 * creatures and never asks them to roll. Read by feature, not by version.
 */
export default class Dnd5eAdapter extends SystemAdapter {
  displayInitiative(combatant) {
    const score = Number(combatant?.actor?.system?.attributes?.init?.score);
    return Number.isFinite(score) ? score : 0;
  }
}
