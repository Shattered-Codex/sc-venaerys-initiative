import Coc7Adapter from "./Coc7Adapter.js";
import DaggerheartAdapter from "./DaggerheartAdapter.js";
import Dnd5eAdapter from "./Dnd5eAdapter.js";
import Pf2eAdapter from "./Pf2eAdapter.js";
import SystemAdapter from "./SystemAdapter.js";

const ADAPTERS = { dnd5e: Dnd5eAdapter, pf2e: Pf2eAdapter, CoC7: Coc7Adapter, daggerheart: DaggerheartAdapter };

/** Picks the adapter of the running system, the generic one when there is none. */
export default class AdapterFactory {
  static create(systemId) {
    const Adapter = ADAPTERS[systemId] ?? SystemAdapter;
    return new Adapter();
  }
}
