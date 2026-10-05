import { MODULE_ID } from "../constants/module-constants.js";
import { normalizeBannerThemes } from "./banner-themes.js";
import { normalizeConsequences } from "./consequence-kinds.js";
import { validatePlan } from "./phase-plan.js";

/**
 * The files the configuration screen exports and imports: the phase list, or
 * the GM's banner themes, as JSON that names the module and what it carries.
 * A file of another kind, or one that is not valid, is refused with a reason
 * and changes nothing.
 */

export const TRANSFER_KINDS = Object.freeze({ phases: "phases", banners: "banners" });
const VERSION = 1;

export function exportPayload(kind, data) {
  return JSON.stringify({ module: MODULE_ID, kind, version: VERSION, data }, null, 2);
}

export function exportFileName(kind) {
  return `${MODULE_ID}-${kind}.json`;
}

/**
 * @returns {{data: object[]}|{error: "NotJson"|"WrongFile"|"WrongKind"|"Invalid"}}
 */
export function parseImport(text, kind) {
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    return { error: "NotJson" };
  }
  if (!file || typeof file !== "object" || file.module !== MODULE_ID || !Array.isArray(file.data)) return { error: "WrongFile" };
  if (file.kind !== kind) return { error: "WrongKind" };
  if (kind === TRANSFER_KINDS.banners) {
    const themes = normalizeBannerThemes(file.data);
    return themes.length || !file.data.length ? { data: themes } : { error: "Invalid" };
  }
  if (!validatePlan(file.data)) return { error: "Invalid" };
  return { data: file.data.map((phase) => ({ ...structuredClone(phase), ...(phase.onEnter ? { onEnter: normalizeConsequences(phase.onEnter) } : {}) })) };
}

/** The GM's banner themes after an import: the file's themes replace the ones with the same id and join the rest. */
export function mergeBannerThemes(current, imported) {
  const ids = new Set(imported.map((theme) => theme.id));
  return [...current.filter((theme) => !ids.has(theme.id)), ...imported];
}
