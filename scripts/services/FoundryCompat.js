/**
 * The only place that knows how Foundry v13 and v14 differ for this module.
 * The combatant row of the combat tracker changed its label keys in v14
 * (`COMBAT.*` became `COMBATANT.*`, and the hide/defeat buttons now name the
 * action they will take), and context menu entries changed shape
 * (`name/condition/callback` became `label/visible/onClick`).
 */
export default class FoundryCompat {
  static get generation() {
    return Number(globalThis.game?.release?.generation) || 13;
  }

  /** Localized labels of a core tracker row, for the row the module draws. */
  static trackerRowLabels(turn, localize = (key) => game.i18n.localize(key)) {
    if (FoundryCompat.generation >= 14) {
      return {
        hidden: localize(turn.hidden ? "COMBATANT.Show" : "COMBATANT.Hide"),
        defeated: localize(turn.isDefeated ? "COMBATANT.UnmarkDefeated" : "COMBATANT.MarkDefeated"),
        ping: localize("COMBATANT.Ping"),
        pan: localize("COMBATANT.PanTo"),
        initiative: localize("COMBATANT.FIELDS.initiative.label"),
        roll: localize("COMBAT.InitiativeRoll"),
      };
    }
    return {
      hidden: localize("COMBAT.ToggleVis"),
      defeated: localize("COMBAT.ToggleDead"),
      ping: localize("COMBAT.PingCombatant"),
      pan: localize("COMBAT.PanToCombatant"),
      initiative: localize("COMBAT.InitiativeScore"),
      roll: localize("COMBAT.InitiativeRoll"),
    };
  }

  /** Message options that show a roll to GMs only (v14 renamed `rollMode: "gmroll"` to `messageMode: "gm"`). */
  static gmOnlyMessage() {
    return FoundryCompat.generation >= 14 ? { messageMode: "gm" } : { rollMode: "gmroll" };
  }

  /**
   * A context menu entry both versions read without a deprecation warning: v13
   * reads `name/condition/callback`, v14 prefers `label/visible/onClick`, and
   * v13 accepts icon HTML, while v14 reads an icon class. `visible(li)` and
   * `onClick(li)` get the row.
   */
  static contextEntry({ label, icon, visible = () => true, onClick }) {
    return {
      name: label,
      label,
      icon: FoundryCompat.generation >= 14 ? icon : `<i class="${icon}"></i>`,
      condition: visible,
      visible,
      callback: (li) => onClick(li),
      onClick: (event, li) => onClick(li),
    };
  }
}
