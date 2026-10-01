import { defaultPlan } from "../../scripts/constants/default-phases.js";
import { MODULE_ID } from "../../scripts/constants/module-constants.js";
import { cachedPhaseRank } from "../../scripts/helpers/phase-order.js";

/**
 * Fake Foundry documents and globals for the service tests. Not a simulator:
 * just enough Combat and Combatant behaviour (dotted-key updates, re-sorting
 * by phase while keeping the pointer on the same combatant, recorded writes)
 * for services to run against.
 */

/** Applies `{"flags.x.y": v, initiative: n, flags: {...}}` onto a document. */
function applyData(doc, data) {
  for (const [key, value] of Object.entries(data)) {
    if (key === "_id") continue;
    if (key === "flags") {
      for (const [scope, fields] of Object.entries(value)) doc.flags[scope] = { ...(doc.flags[scope] ?? {}), ...fields };
      continue;
    }
    const path = key.split(".");
    let node = doc;
    while (path.length > 1) {
      const part = path.shift();
      node = node[part] ??= {};
    }
    node[path[0]] = value;
  }
}

export function fakeCombatant({ id, name = id, flags = {}, initiative = null, initScore = 0, actorId = null, disposition = -1, hasToken = true, ...rest } = {}) {
  const combatant = {
    id,
    name,
    img: null,
    initiative,
    hidden: false,
    visible: true,
    isOwner: false,
    hasPlayerOwner: false,
    isDefeated: false,
    defeated: false,
    actorId: actorId ?? `actor-${id}`,
    flags: { [MODULE_ID]: { ...flags } },
    token: hasToken ? { disposition, baseActor: { id: actorId ?? `actor-${id}` } } : null,
    actor: { system: { attributes: { init: { score: initScore } } } },
    parent: null,
    updates: [],
    async update(data, options = {}) {
      this.updates.push({ data, options });
      await this.parent.updateEmbeddedDocuments("Combatant", [{ _id: this.id, ...data }], options);
      return this;
    },
    ...rest,
  };
  return combatant;
}

/** Turn order: phase rank (pending last), then initiative, then id. */
function sortTurns(combat) {
  const plan = combat.flags[MODULE_ID]?.enabled ? combat.flags[MODULE_ID].plan : null;
  const init = (c) => (Number.isFinite(c.initiative) ? c.initiative : -Infinity);
  combat.turns.sort((a, b) => {
    const byPhase = plan ? cachedPhaseRank(plan, a.flags[MODULE_ID]?.phase ?? null) - cachedPhaseRank(plan, b.flags[MODULE_ID]?.phase ?? null) : 0;
    return byPhase || init(b) - init(a) || (a.id > b.id ? 1 : -1);
  });
}

export function fakeCombat({ id = "combat", round = 1, turn = 0, flags = {}, combatants = [], phased = true } = {}) {
  const combat = {
    id,
    round,
    turn,
    previous: { round, turn },
    flags: { [MODULE_ID]: phased ? { enabled: true, plan: defaultPlan(), dc: { value: 15, source: "manual" }, suspendedAdvance: null, ...flags } : { ...flags } },
    turns: [...combatants],
    calls: [],
    get started() {
      return this.round > 0;
    },
    get combatant() {
      return this.turn === null ? null : this.turns[this.turn] ?? null;
    },
    combatants: {
      get: (cid) => combat.turns.find((c) => c.id === cid),
      map: (fn) => combat.turns.map(fn),
      get contents() {
        return [...combat.turns];
      },
      [Symbol.iterator]: () => combat.turns[Symbol.iterator](),
    },
    getTimeDelta(fromRound, _fromTurn, toRound) {
      return (Math.max(toRound, 1) - Math.max(fromRound, 1)) * 6;
    },
    setupTurns() {
      const current = this.combatant;
      sortTurns(this);
      if (current) this.turn = this.turns.indexOf(current);
      this.calls.push({ type: "setupTurns" });
      return this.turns;
    },
    async update(data, options = {}) {
      this.calls.push({ type: "update", data: structuredClone(data), options });
      this.previous = { round: this.round, turn: this.turn };
      applyData(this, data);
      return this;
    },
    async updateEmbeddedDocuments(type, updates, options = {}) {
      this.calls.push({ type: "embedded", updates: structuredClone(updates), options });
      const current = this.combatant;
      for (const update of updates) applyData(this.combatants.get(update._id), update);
      sortTurns(this);
      if (typeof options.combatTurn === "number") this.turn = options.combatTurn;
      else if (current) this.turn = this.turns.indexOf(current);
      return updates;
    },
    async startCombat() {
      this.calls.push({ type: "startCombat" });
      return this.update({ round: 1, turn: 0 });
    },
    writes(type) {
      return this.calls.filter((c) => c.type === type);
    },
  };
  for (const c of combatants) c.parent = combat;
  sortTurns(combat);
  return combat;
}

/** Installs the Foundry globals the services read. Returns what they recorded. */
export function installGame({ isGM = true, isActiveGM = isGM, settings = {}, combats = [], systemId = "test" } = {}) {
  const recorded = { hooks: [], warnings: [], socket: [], errors: [] };
  const values = { autoAdvance: true, defaultDc: 15, enabledByDefault: true, showDcToPlayers: false, openOnStart: true, phaseTemplate: defaultPlan(), ...settings };
  const user = { id: isGM ? "gm" : "player", isGM, isActiveGM };
  const users = new Map([["gm", { id: "gm", isGM: true }], ["co-gm", { id: "co-gm", isGM: true }], ["player", { id: "player", isGM: false }]]);
  globalThis.game = {
    user,
    system: { id: systemId },
    users: { get: (uid) => users.get(uid), activeGM: isActiveGM ? user : users.get("co-gm") },
    combats: {
      get: (cid) => combats.find((c) => c.id === cid),
      [Symbol.iterator]: () => combats[Symbol.iterator](),
    },
    settings: { get: (_module, key) => values[key], set: async (_module, key, value) => (values[key] = value) },
    i18n: { localize: (key) => key, format: (key, data) => `${key}${JSON.stringify(data)}` },
    socket: { on: () => {}, emit: (...args) => recorded.socket.push(args) },
  };
  globalThis.ui = { notifications: { warn: (text) => recorded.warnings.push(text) }, windows: {} };
  globalThis.Hooks = { callAll: (...args) => recorded.hooks.push(args), on: () => 1 };
  globalThis.CONFIG = { specialStatusEffects: { DEFEATED: "dead" }, Combat: { initiative: { decimals: 2 } } };
  globalThis.foundry = {
    utils: {
      hasProperty: (object, path) => {
        let node = object;
        for (const key of path.split(".")) {
          if (node === null || typeof node !== "object" || !(key in node)) return false;
          node = node[key];
        }
        return true;
      },
      getProperty: (object, path) => path.split(".").reduce((node, key) => node?.[key], object),
      escapeHTML: (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    },
    applications: { instances: new Map(), api: {}, dice: {} },
  };
  return recorded;
}

/** Runs queued timers and microtasks so fire-and-forget work settles. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A requestFrame that runs only when the test says so. */
export function manualFrames() {
  const queue = [];
  const requestFrame = (callback) => queue.push(callback);
  const run = async () => {
    while (queue.length) await queue.shift()();
  };
  return { requestFrame, run, get size() {
    return queue.length;
  } };
}
