import { SOUND_MODES } from "../constants/module-constants.js";

/**
 * The sound of a phase when it starts. Without a choice a phase is silent:
 * the core's turn sounds stay quiet while the combat is in it. "theme" lets
 * the core's combat theme play as in any combat; "custom" keeps the core
 * quiet and plays the GM's own file instead.
 */

const MODES = Object.values(SOUND_MODES);
export const DEFAULT_VOLUME = 70;

/** A phase's sound with every field typed and defaulted. */
export function normalizePhaseSound(raw) {
  const volume = Number(raw?.volume);
  return {
    mode: MODES.includes(raw?.mode) ? raw.mode : SOUND_MODES.none,
    src: String(raw?.src ?? "").trim(),
    volume: Number.isFinite(volume) && raw?.volume !== "" && raw?.volume !== null ? Math.min(Math.max(volume, 0), 100) : DEFAULT_VOLUME,
  };
}

export function phaseSound(phase) {
  return normalizePhaseSound(phase?.sound);
}

/** Whether the core's turn sounds stay quiet while the combat is in this phase. */
export function silencesTheme(phase) {
  return phaseSound(phase).mode !== SOUND_MODES.theme;
}

/** The file to play when the phase starts, or null. */
export function customSound(phase) {
  const sound = phaseSound(phase);
  return sound.mode === SOUND_MODES.custom && sound.src ? { src: sound.src, volume: sound.volume / 100 } : null;
}

/** The plan with one phase's sound changed; silence with no file, the default, leaves no field behind. */
export function setPhaseSound(plan, id, change) {
  return plan.map((phase) => {
    if (phase.id !== id) return phase;
    const sound = normalizePhaseSound({ ...phaseSound(phase), ...change });
    const { sound: _old, ...rest } = phase;
    return sound.mode === SOUND_MODES.none && !sound.src ? rest : { ...rest, sound };
  });
}
