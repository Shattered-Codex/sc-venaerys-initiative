import { I18N_ROOT, KEYBINDINGS, MODULE_ID } from "../constants/module-constants.js";

/**
 * Registers the module's keybindings at `init`, none with a default key.
 * `actions[id]` runs on key down and answers whether it did something; when
 * it did not, the key is left to other bindings.
 */
export function registerKeybindings(actions) {
  for (const { id, gm } of KEYBINDINGS) {
    game.keybindings.register(MODULE_ID, id, {
      name: `${I18N_ROOT}.Keybindings.${id}.Name`,
      hint: `${I18N_ROOT}.Keybindings.${id}.Hint`,
      editable: [],
      restricted: gm,
      onDown: () => actions[id]?.() === true,
    });
  }
}
