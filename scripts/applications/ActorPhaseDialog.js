import { ACTOR_FLAGS, I18N_ROOT, MODULE_ID, PHASE_TYPES, SETTINGS } from "../constants/module-constants.js";
import { displayName } from "../helpers/phase-plan.js";
import { getSetting } from "../hooks/register-settings.js";
import CombatSnapshot from "../services/CombatSnapshot.js";
import ThemeApplier from "../services/ThemeApplier.js";

const FLAG_PATH = `flags.${MODULE_ID}.${ACTOR_FLAGS.defaultPhase}`;

/**
 * "Combat phase" on a creature's sheet, for the GM: the phase it takes in
 * every combat (Enemies by default, or a creature phase of the template:
 * Epic Boss, Boss…). It is only its automatic phase: the GM still moves it in
 * the tracker, and a phase later deleted from the template sends it back to
 * Enemies. A token's own sheet sets it for that token alone.
 */
export default class ActorPhaseDialog {
  /** Creatures only: a character a player owns rolls against the DC instead. */
  static appliesTo(actor) {
    return !!actor && game.user.isGM && !actor.hasPlayerOwner;
  }

  /** The "…" menu of an Application V2 actor sheet. */
  static addHeaderControl(app, controls) {
    const actor = app.document ?? app.actor;
    if (!ActorPhaseDialog.appliesTo(actor)) return;
    controls.push({
      icon: "fa-solid fa-layer-group",
      label: `${I18N_ROOT}.ActorPhase.Menu`,
      action: "sviActorPhase",
      onClick: () => ActorPhaseDialog.open(actor),
    });
  }

  /** The header buttons of an Application V1 actor sheet (systems not on V2 yet). */
  static addHeaderButton(app, buttons) {
    const actor = app.actor ?? app.document;
    if (!ActorPhaseDialog.appliesTo(actor)) return;
    buttons.unshift({
      label: game.i18n.localize(`${I18N_ROOT}.ActorPhase.Button`),
      class: "svi-actor-phase",
      icon: "fa-solid fa-layer-group",
      onclick: () => ActorPhaseDialog.open(actor),
    });
  }

  /** The choices: Enemies (no flag) first, then every creature phase of the world's template. */
  static choices(actor) {
    const localize = (key) => game.i18n.localize(key);
    const saved = CombatSnapshot.flagsOf(actor)[ACTOR_FLAGS.defaultPhase] ?? "";
    const phases = getSetting(SETTINGS.phaseTemplate).filter((phase) => phase.type === PHASE_TYPES.creatures);
    const known = phases.some((phase) => phase.id === saved);
    return [
      { value: "", label: localize(`${I18N_ROOT}.ActorPhase.Enemies`), icon: "fa-solid fa-users", checked: !known },
      ...phases.map((phase) => ({ value: phase.id, label: displayName(phase, localize), icon: phase.icon, checked: phase.id === saved })),
    ];
  }

  static async open(actor) {
    const escape = (text) => foundry.utils.escapeHTML(String(text));
    const radios = ActorPhaseDialog.choices(actor).map((choice) =>
      `<label class="svi-actor-phase-choice"><input type="radio" name="phaseId" value="${escape(choice.value)}"${choice.checked ? " checked" : ""}>`
      + `<i class="${escape(choice.icon)}" inert></i><span>${escape(choice.label)}</span></label>`);
    const phaseId = await foundry.applications.api.DialogV2.prompt({
      classes: [MODULE_ID, "svi-dialog", "svi-actor-phase-dialog"],
      window: { title: game.i18n.format(`${I18N_ROOT}.ActorPhase.Title`, { name: actor.name }), icon: "fa-solid fa-layer-group" },
      content: `<p class="svi-actor-phase-hint">${escape(game.i18n.localize(`${I18N_ROOT}.ActorPhase.Hint`))}</p>`
        + `<fieldset class="svi-actor-phase-list"><legend>${escape(game.i18n.localize(`${I18N_ROOT}.ActorPhase.Legend`))}</legend>${radios.join("")}</fieldset>`,
      ok: { label: `${I18N_ROOT}.ActorPhase.Save`, icon: "fa-solid fa-check", callback: (event, button) => button.form.elements.phaseId.value },
      rejectClose: false,
      render: (event, dialog) => ThemeApplier.apply(dialog.element),
    });
    if (phaseId === null || phaseId === undefined) return;
    await actor.update({ [FLAG_PATH]: phaseId || null });
  }
}
