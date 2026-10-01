import Dnd5eAdapter from "./Dnd5eAdapter.js";
import SystemAdapter from "./SystemAdapter.js";

const ADAPTERS = { dnd5e: Dnd5eAdapter };

/** Picks the adapter of the running system, the generic one when there is none. */
export default class AdapterFactory {
  static create(systemId) {
    const Adapter = ADAPTERS[systemId] ?? SystemAdapter;
    return new Adapter();
  }
}
