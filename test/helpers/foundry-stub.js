/**
 * Just enough Foundry for the module's ES graph to LOAD in Node.
 *
 * Not a simulator: no document, no canvas, no rendering. It exists because a
 * single import-time mistake — a broken named import, a class extending
 * something that does not exist, a stray syntax error — takes the whole graph
 * down at load, and Foundry's own symptom for that is unrelated ("sheet.getData
 * is not a function"): the module simply never registered anything.
 *
 * Everything the module reaches for at import time answers; what it does with
 * the answer is not this file's business.
 */

/** A value that can be read, called, constructed and extended, forever. */
function stub(name) {
  const target = function ScStub() {};
  Object.defineProperty(target, "name", { value: name });
  const cache = new Map();
  return new Proxy(target, {
    get(self, prop) {
      if (prop === "prototype") return self.prototype;
      if (prop === "name") return name;
      // NOT thenable: a stub that answers `then` with another callable makes
      // `await` hang forever waiting for a resolve nobody will call
      if (prop === "then") return undefined;
      if (typeof prop === "symbol") return Reflect.get(self, prop);
      if (!cache.has(prop)) cache.set(prop, stub(`${name}.${String(prop)}`));
      return cache.get(prop);
    },
    set(self, prop, value) {
      cache.set(prop, value);
      return true;
    },
    has: () => true,
    apply: () => stub(`${name}()`),
    construct(self) {
      return Object.create(self.prototype);
    },
  });
}

/** The handful of helpers that must really work, because real code calls them. */
const realUtils = {
  debounce: (fn) => fn,
  deepClone: (value) => structuredClone(value),
  duplicate: (value) => structuredClone(value),
  mergeObject: (a, b) => ({ ...(a ?? {}), ...(b ?? {}) }),
  randomID: () => Math.random().toString(36).slice(2, 18),
  escapeHTML: (text) =>
    String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
  expandObject: (flat) => {
    const out = {};
    for (const [path, value] of Object.entries(flat ?? {})) {
      const keys = path.split(".");
      let node = out;
      while (keys.length > 1) node = node[keys.shift()] ??= {};
      node[keys[0]] = value;
    }
    return out;
  },
  hasProperty: (object, path) => {
    let node = object;
    for (const key of String(path).split(".")) {
      if (node === null || typeof node !== "object" || !(key in node)) return false;
      node = node[key];
    }
    return true;
  },
  getProperty: (object, path) => {
    let node = object;
    for (const key of String(path).split(".")) {
      if (node === null || typeof node !== "object") return undefined;
      node = node[key];
    }
    return node;
  },
};

/** …and a stub for every other helper, so a new call site never fails here. */
const utils = new Proxy(realUtils, {
  get: (self, prop) =>
    prop in self ? self[prop] : (self[prop] = stub(`foundry.utils.${String(prop)}`)),
  has: () => true,
});

/** Hooks the module registered while loading — the point of the exercise. */
export const registered = { once: new Map(), on: new Map() };

/** The module's own record, so `mod.api = {…}` lands somewhere we can read. */
export const moduleRecord = { id: "sc-venaerys-initiative", active: true, api: null };

/** A `game` with the pieces `init` really uses, and stubs for the rest. */
function makeGame() {
  const real = {
    combat: null,
    combats: [],
    modules: {
      get: (id) => (id === moduleRecord.id ? moduleRecord : { id, active: false }),
    },
    settings: {
      register: () => {},
      registerMenu: () => {},
      get: () => ({}),
      set: async () => {},
    },
    keybindings: { register: () => {} },
    i18n: {
      localize: (key) => key,
      // the data is kept visible so a test can assert what was interpolated
      format: (key, data = {}) => {
        const args = Object.entries(data ?? {})
          .map(([name, value]) => `${name}=${value}`)
          .join(",");
        return args ? `${key}(${args})` : key;
      },
      has: () => true,
    },
    user: { id: "gm", isGM: true, name: "GM" },
    users: { activeGM: null, get: () => null, contents: [], filter: () => [], find: () => null },
    journal: [],
    scenes: [],
    messages: { contents: [] },
    system: { id: "test" },
  };
  return new Proxy(real, {
    get: (self, prop) =>
      prop in self ? self[prop] : (self[prop] = stub(`game.${String(prop)}`)),
    has: () => true,
  });
}

/** The two DOM calls the triggers make while registering. */
function makeDocument() {
  const element = () => ({
    className: "",
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    append() {},
    appendChild() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  return {
    body: { addEventListener() {}, appendChild() {}, append() {} },
    createElement: element,
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

export function installFoundryStubs() {
  const root = stub("foundry");
  root.utils = utils;
  globalThis.foundry = root;

  globalThis.Hooks = {
    once: (event, fn) => registered.once.set(event, fn),
    on: (event, fn) => {
      if (!registered.on.has(event)) registered.on.set(event, []);
      registered.on.get(event).push(fn);
      return registered.on.get(event).length;
    },
    off: () => {},
    call: () => true,
    callAll: () => true,
  };

  const config = { time: { roundTime: 6 }, ui: {} };
  globalThis.CONFIG = new Proxy(config, {
    get: (self, prop) =>
      prop in self ? self[prop] : (self[prop] = stub(`CONFIG.${String(prop)}`)),
    has: () => true,
  });
  globalThis.CONST = stub("CONST");
  globalThis.game = makeGame();
  globalThis.document = makeDocument();
  globalThis.ui = stub("ui");
  globalThis.canvas = stub("canvas");
  globalThis.ChatMessage = stub("ChatMessage");
  globalThis.Roll = stub("Roll");
  globalThis.PIXI = stub("PIXI");
  globalThis.TextEditor = stub("TextEditor");
  globalThis.fromUuid = async () => null;
  globalThis.fromUuidSync = () => null;

  // core adds these to the built-ins, and module code calls them freely
  Math.clamp ??= (value, min, max) => Math.min(Math.max(value, min), max);
  Array.fromRange ??= (n, start = 0) => Array.from({ length: n }, (_, i) => i + start);
  Number.isNumeric ??= (value) => Number.isFinite(Number(value));
}
