import { COMBATANT_FLAGS, MODULE_ID, OPERATION_KEY, REASONS } from "../constants/module-constants.js";
import CombatSnapshot from "./CombatSnapshot.js";

const NATURAL_PATH = `flags.${MODULE_ID}.${COMBATANT_FLAGS.natural}`;

/**
 * The critical or fumble of a system initiative roll, written by whoever
 * rolled it. The core saves the total and posts the roll in a chat message
 * afterwards; the author's client reads the message and writes `natural` on
 * its own combatant (owners may), tied to the total it came with, so an
 * initiative typed later never inherits it. Only a critical or a fumble is
 * written, or one cleared that a new roll with the same total would
 * otherwise inherit. The module's own formula rolls write theirs with the
 * initiative and are skipped here.
 */
export default class NaturalRollRecorder {
  constructor({ adapter }) {
    this.adapter = adapter;
  }

  /** The owned combatants of a phased combat the speaker stands for, with this total. */
  static #combatantsOf(speaker, total) {
    const found = [];
    for (const combat of game.combats ?? []) {
      if (!CombatSnapshot.isPhased(combat)) continue;
      const bySpeaker = speaker?.token ? combat.getCombatantsByToken(speaker.token) : combat.getCombatantsByActor(speaker?.actor);
      found.push(...bySpeaker.filter((c) => c.isOwner && c.initiative === total));
    }
    return found;
  }

  async onCreateChatMessage(message) {
    if (!message.getFlag?.("core", "initiativeRoll") || message.author?.id !== game.user.id) return;
    if (message.getFlag?.(MODULE_ID, "formulaRoll")) return;
    const roll = message.rolls?.[0];
    if (!roll || !Number.isFinite(roll.total)) return;
    const value = this.adapter.criticalOf(roll);
    for (const combatant of NaturalRollRecorder.#combatantsOf(message.speaker, roll.total)) {
      const recorded = CombatSnapshot.flagsOf(combatant)[COMBATANT_FLAGS.natural];
      if (value === null && recorded?.initiative !== roll.total) continue;
      if (recorded?.value === value && recorded?.initiative === roll.total) continue;
      await combatant.update({ [NATURAL_PATH]: value === null ? null : { value, initiative: roll.total } }, { [OPERATION_KEY]: { reason: REASONS.natural } });
    }
  }
}
