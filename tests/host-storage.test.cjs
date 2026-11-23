'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const files = [
  'core/random', 'data/catalog', 'core/scoring', 'core/storage', 'core/ui', 'core/game-host',
  'data/questions', 'data/stimuli', 'data/twenty-four',
  'games/memory', 'games/imagination', 'games/logic', 'games/reaction', 'games/attention', 'games/calculation'
];
const scripts = files.map(file => new vm.Script(fs.readFileSync(path.join(root, 'js', file + '.js'), 'utf8'), { filename: 'js/' + file + '.js' }));
const plain = value => JSON.parse(JSON.stringify(value));
const ids = 'A1 A2 A3 B1 B2 B3 C1 C2 C3 D1 D2 D3 E1 E2 E3 F1 F2 F3'.split(' ');

// Only browser primitives are simulated. Host, UI, registry, data, scoring and
// validation/persistence below are the production scripts, not status stubs.
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = document;
    this.parentNode = null; this.children = []; this.handlers = new Map();
    this.attributes = new Map(); this.dataset = {}; this.className = ''; this.disabled = false;
    this.tabIndex = -1; this._text = '';
    this.style = { setProperty: (key, value) => { this.style[key] = String(value); } };
    this.classList = {
      contains: name => this.className.split(/\s+/).includes(name),
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
      toggle: (name, force) => {
        const enabled = force === undefined ? !this.classList.contains(name) : force;
        this.classList[enabled ? 'add' : 'remove'](name); return enabled;
      }
    };
  }
  get isConnected() { return this.tagName === '#DOCUMENT' || Boolean(this.parentNode?.isConnected); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  append(...nodes) {
    for (const node of nodes) {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
      node.parentNode = this; this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => { node.parentNode = null; }); this.children = []; this._text = ''; this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  focus() { if (!this.disabled) this.ownerDocument.activeElement = this; }
  addEventListener(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector === 'dialog[open]') return this.tagName === 'DIALOG' && this.attributes.has('open');
    return this.tagName.toLowerCase() === selector.toLowerCase();
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function event(target, type, properties = {}) {
  return { target, type, button: 0, detail: 0, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
}
function dispatch(target, type, properties = {}) {
  const e = event(target, type, properties);
  for (let node = target; node; node = node.parentNode) {
    e.currentTarget = node;
    for (const handler of [...(node.handlers.get(type) || [])]) handler(e);
  }
  return e;
}
function pointer(button) {
  if (button.disabled) return;
  dispatch(button, 'pointerdown', { pointerId: 1 });
  dispatch(button, 'pointerup', { pointerId: 1 });
  dispatch(button, 'click', { detail: 1 });
}
function key(target, key, properties = {}) {
  const e = dispatch(target, 'keydown', { key, ...properties });
  // Only model native Enter activation, not an extra game callback.
  if (key === 'Enter' && !e.defaultPrevented && target.tagName === 'BUTTON' && !target.disabled) dispatch(target, 'click');
  return e;
}

function backend(initial = null) {
  const map = new Map(initial === null ? [] : [['mindorbit:data', initial]]), writes = [];
  return {
    map, writes,
    getItem: key => map.get(key) ?? null,
    setItem(key, value) { value = String(value); writes.push({ key, value }); map.set(key, value); },
    removeItem: key => map.delete(key)
  };
}

function environment(options = {}) {
  let now = options.now || 0, nextId = 0, randomWord = 0, scheduled = 0;
  const timers = new Map(), errors = [], nodes = [];
  const document = new Element('#document'); document.ownerDocument = document; nodes.push(document);
  document.createElement = tag => { const node = new Element(tag, document); nodes.push(node); return node; };
  document.createElementNS = (namespace, tag) => document.createElement(tag);
  document.body = document.createElement('body'); document.append(document.body); document.activeElement = document.body; document.hidden = false;
  const windowEvents = new Element('#window', document); nodes.push(windowEvents);
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [Date.UTC(2026, 10, 22, 12) + now])); }
    static now() { return Date.UTC(2026, 10, 22, 12) + now; }
  }
  const enqueue = (fn, delay, kind = 'timeout') => {
    const id = ++nextId; scheduled++; timers.set(id, { fn, at: now + Math.max(0, Number(delay) || 0), kind }); return id;
  };
  const sandbox = {
    document, Date: ClockDate, performance: { now: () => now },
    crypto: { getRandomValues(array) { for (let i = 0; i < array.length; i++) array[i] = ++randomWord; return array; } },
    console: { ...console, error: (...args) => errors.push(args) },
    setTimeout: enqueue, clearTimeout: id => timers.delete(id),
    requestAnimationFrame: fn => enqueue(() => fn(now), 16, 'frame'), cancelAnimationFrame: id => timers.delete(id),
    addEventListener: windowEvents.addEventListener.bind(windowEvents), removeEventListener: windowEvents.removeEventListener.bind(windowEvents)
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox); scripts.forEach(script => script.runInContext(context));
  const M = sandbox.MindOrbit, disk = options.backend || backend(); M.store = M.storage.create(disk);
  const advanceTo = target => {
    assert.ok(target >= now, 'clock must be monotonic');
    let count = 0;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++count < 30000, 'no runaway timer loop');
      timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].fn();
    }
    now = target;
  };
  return {
    M, document, windowEvents, sandbox, disk, nodes, timers, errors, advanceTo,
    now: () => now, scheduled: () => scheduled,
    jumpTo(target) { assert.ok(target >= now); now = target; },
    rootWrites: () => disk.writes.filter(write => write.key === M.storage.KEY),
    listeners: () => nodes.flatMap(target => [...target.handlers].flatMap(([type, handlers]) => [...handlers].map(fn => ({ target, type, fn }))))
  };
}

function makeHost(env, id = 'E2', options = {}) {
  const { M, document } = env;
  const elements = options.elements || Object.fromEntries(['container', 'status', 'progress', 'bar', 'timer', 'total'].map(name => [name, document.createElement('div')]));
  if (!options.elements) document.body.append(...Object.values(elements));
  const records = [], results = [], aborts = [], calls = { create: 0, start: 0, timeout: 0, destroy: 0, finish: 0, timeoutFinish: 0 }, timeoutReturns = [];
  let ctx, session, inTimeout = false;
  const definition = M.games[id];
  const game = { ...definition, createSession(context) {
    calls.create++; ctx = context;
    const finish = ctx.finish;
    ctx.finish = (...args) => { calls.finish++; if (inTimeout) calls.timeoutFinish++; return finish(...args); };
    session = (options.createSession || definition.createSession)(ctx);
    if (!session) return session;
    // Transparent observation of real callbacks; do not manufacture outcomes.
    return Object.fromEntries(['start', 'onTimeout', 'destroy'].map(name => [name, typeof session[name] !== 'function' ? session[name] : (...args) => {
      calls[name === 'onTimeout' ? 'timeout' : name]++;
      if (name !== 'onTimeout') return session[name](...args);
      inTimeout = true;
      try { const value = session[name](...args); timeoutReturns.push(value); return value; }
      finally { inTimeout = false; }
    }]));
  } };
  const host = M.createHost(game, elements, {
    onFinish(record, result) { records.push(record); results.push(result); }, onAbort(message) { aborts.push(message); }
  });
  return { env, host, elements, records, results, aborts, calls, timeoutReturns,
    get ctx() { return ctx; }, get session() { return session; },
    start() { host.startPreparing(); env.advanceTo(env.now() + 3000); return this; }
  };
}
const schulte = (patch = {}) => ({ completed: false, progress: 0, errors: 0, durationMs: 120000, layout: Array.from({ length: 25 }, (_, i) => i + 1), ...patch });
function controlled(env, callbacks = {}) {
  return makeHost(env, 'E2', { createSession(ctx) {
    return { start: () => callbacks.start?.(ctx), onTimeout: () => callbacks.timeout ? callbacks.timeout(ctx) : schulte(), destroy: () => callbacks.destroy?.(ctx) };
  } });
}
function assertNoResults(run) {
  assert.equal(run.records.length, 0); assert.equal(run.env.rootWrites().length, 0);
  assert.equal(run.env.M.store.data.revision, 0); assert.deepEqual(plain(run.env.M.store.data.games), {});
  assert.equal(run.env.M.store.data.streak.totalDays, 0);
}
function assertClean(run) {
  assert.equal(run.env.timers.size, 0, 'all timers and animation frames removed');
  assert.equal(run.env.listeners().length, 0, 'listeners removed even on detached nodes');
}
function assertSaved(run, outcome) {
  assert.equal(run.host.state, 'finished', run.aborts.join('\n')); assert.equal(run.aborts.length, 0);
  assert.equal(run.records.length, 1); assert.equal(run.results[0].saved, true);
  assert.equal(run.env.errors.length, 0, 'successful production integration must not log callback errors');
  const record = run.records[0], { M, disk } = run.env;
  assert.equal(record.outcome, outcome); assert.equal(M.storage.validRecord(record, record.gameId), true);
  assert.equal(M.storage.validate(M.store.data), true); assert.equal(M.storage.validate(JSON.parse(disk.getItem(M.storage.KEY))), true);
  assert.equal(run.env.rootWrites().length, 1); assert.equal(M.store.data.revision, 1);
  assert.equal(M.store.data.games[record.gameId].history.length, 1);
  assert.equal(M.store.data.games[record.gameId].statsByRulesVersion['1'].completedCount, 1);
  assert.equal(M.store.data.streak.totalDays, 1); assertClean(run);
}

test('host prepares for exactly three seconds; only one start and an immutable 120000-ms deadline', () => {
  const env = environment({ now: 9000 }), run = controlled(env);
  assert.equal(run.host.state, 'idle'); assert.equal(run.host.active, false);
  run.host.startPreparing(); run.host.startPreparing();
  assert.equal(run.calls.create, 1); assert.equal(run.host.state, 'preparing'); assert.equal(run.host.active, true);
  assert.equal(run.ctx.sessionDeadline, Infinity); assert.equal(run.ctx.elapsed(), 0);
  assert.equal(run.elements.container.querySelector('.countdown-number').textContent, '3');
  env.advanceTo(9999); assert.equal(run.calls.start, 0);
  env.advanceTo(10000); assert.equal(run.elements.container.querySelector('.countdown-number').textContent, '2');
  env.advanceTo(11000); assert.equal(run.elements.container.querySelector('.countdown-number').textContent, '1');
  env.advanceTo(11999); assertNoResults(run); assert.equal(run.calls.start, 0);
  env.advanceTo(12000); assert.equal(run.host.state, 'running'); assert.equal(run.calls.start, 1);
  assert.equal(run.ctx.sessionDeadline, 132000); assert.equal(run.ctx.elapsed(), 0);
  assert.throws(() => { run.ctx.sessionDeadline = Infinity; }, TypeError);
  run.ctx.setStage('answering'); run.ctx.setRemaining(12100); env.advanceTo(12200);
  assert.equal(run.host.state, 'running', 'a question countdown is not the session cutoff');
  run.ctx.setRemaining(Infinity); run.host.startPreparing();
  env.advanceTo(131999); assert.equal(run.host.state, 'running'); assert.equal(run.ctx.elapsed(), 119999);
  env.advanceTo(132000); assertSaved(run, 'timeout');
  assert.equal(run.records[0].durationMs, 120000); assert.equal(run.calls.timeout, 1); assert.equal(run.calls.destroy, 1);
});

for (const phase of ['preparing', 'running']) {
  test('hidden document aborts ' + phase + ' without a result, streak or storage write', () => {
    const env = environment(), run = makeHost(env, 'D3'); run.host.startPreparing();
    if (phase === 'running') env.advanceTo(3000);
    const stale = [...env.timers.values()].map(timer => timer.fn);
    env.document.hidden = true; dispatch(env.document, 'visibilitychange');
    assert.equal(run.host.state, 'aborted'); assert.equal(run.host.active, false); assert.equal(run.aborts.length, 1);
    assert.equal(run.calls.destroy, 1); assertClean(run); assertNoResults(run);
    env.document.hidden = false; dispatch(env.document, 'visibilitychange'); run.host.startPreparing();
    stale.forEach(fn => fn()); env.advanceTo(200000); assertNoResults(run); assert.equal(run.aborts.length, 1);
  });
}

test('window/document blur and visible visibilitychange do not abort a run', () => {
  const env = environment(), run = makeHost(env); run.host.startPreparing();
  dispatch(env.windowEvents, 'blur'); dispatch(env.document, 'blur'); env.advanceTo(3000);
  dispatch(env.windowEvents, 'blur'); dispatch(env.document, 'visibilitychange');
  assert.equal(run.host.state, 'running'); assert.equal(run.aborts.length, 0);
  env.advanceTo(123000); assertSaved(run, 'timeout');
});

test('first finish wins, cancels all resources and produces exactly one real store submission', () => {
  const env = environment(); let queued, listener;
  const run = controlled(env, { start(ctx) {
    queued = () => ctx.finish('timeout', schulte()); ctx.schedule(queued, 10000); ctx.frame(queued);
    listener = ctx.listen(env.document, 'keydown', queued);
  } });
  run.start(); const stale = [...env.timers.values()].map(timer => timer.fn); env.jumpTo(3010);
  const first = schulte({ completed: true, progress: 25, durationMs: 10 });
  run.ctx.finish('completed', first); run.ctx.finish('timeout', schulte());
  listener(event(env.document, 'keydown', { key: 'Enter' })); stale.forEach(fn => fn()); queued(); run.host.abort('late abort');
  assertSaved(run, 'completed'); assert.equal(run.records[0].score, 100); assert.equal(run.calls.destroy, 1); assert.equal(run.calls.timeout, 0);
  const before = env.rootWrites().length;
  assert.equal(env.M.store.save(run.records[0]).duplicate, true); assert.equal(env.rootWrites().length, before);
  env.advanceTo(200000); assert.equal(run.records.length, 1);
});

for (const delay of [119999, 120000, 120731]) {
  test('real E2 final click at elapsed ' + delay + ' respects deadline before input', () => {
    const env = environment(), run = makeHost(env).start(), cells = run.elements.container.querySelectorAll('button');
    for (let n = 1; n < 25; n++) pointer(cells.find(cell => Number(cell.textContent) === n));
    // Do not flush due timers: the input guard itself must settle timeout first.
    env.jumpTo(3000 + delay); pointer(cells.find(cell => Number(cell.textContent) === 25));
    assertSaved(run, delay < 120000 ? 'completed' : 'timeout');
    assert.equal(run.records[0].metrics.progress, delay < 120000 ? 25 : 24);
    assert.equal(run.records[0].durationMs, Math.min(delay, 120000));
    assert.equal(run.calls.timeout, delay < 120000 ? 0 : 1);
  });
}

test('finish at the deadline also routes through synchronous onTimeout and ignores nested finishes', () => {
  const env = environment(); let stateDuringTimeout;
  const run = controlled(env, { timeout(ctx) {
    stateDuringTimeout = run.host.state;
    ctx.finish('completed', schulte({ completed: true, progress: 25 }));
    ctx.finish('timeout', schulte()); return schulte();
  } });
  run.start(); env.jumpTo(123000); run.ctx.finish('completed', schulte({ completed: true, progress: 25 }));
  assert.equal(stateDuringTimeout, 'settling'); assertSaved(run, 'timeout'); assert.equal(run.calls.timeout, 1);
  assert.equal(run.records[0].metrics.progress, 0); assert.equal(typeof run.timeoutReturns[0]?.then, 'undefined');
  env.advanceTo(200000); assert.equal(run.records.length, 1);
});

test('repeat Enter is prevented before native click; real UI/grid retains keyboard reach and mixed input', () => {
  const env = environment(), run = makeHost(env).start(), cells = run.elements.container.querySelectorAll('button');
  assert.equal(cells.filter(cell => cell.tabIndex === 0).length, 25);
  const first = cells.find(cell => cell.textContent === '1'); first.focus();
  assert.equal(key(first, 'Enter', { repeat: true }).defaultPrevented, true); assert.equal(run.elements.progress.textContent, '0 / 25');
  key(first, 'Enter'); assert.equal(run.elements.progress.textContent, '1 / 25');
  for (let n = 2; n <= 25; n++) pointer(cells.find(cell => Number(cell.textContent) === n));
  assertSaved(run, 'completed'); assert.equal(run.records[0].inputMode, 'mixed');
});

for (const source of ['createSession', 'interface', 'start', 'timer', 'frame', 'listener', 'onTimeout', 'score']) {
  test('technical ' + source + ' exception aborts without saving results', () => {
    const env = environment(); const boom = () => { throw new Error('intentional callback error'); };
    const run = makeHost(env, 'E2', { createSession(ctx) {
      if (source === 'createSession') boom();
      if (source === 'interface') return { start() {} };
      return {
        start() {
          if (source === 'start') boom();
          if (source === 'timer') ctx.schedule(boom, 1);
          if (source === 'frame') ctx.frame(boom);
          if (source === 'listener') ctx.listen(env.document, 'keydown', boom);
          if (source === 'score') ctx.finish('completed', { completed: true, durationMs: NaN, errors: 0 });
        },
        onTimeout: source === 'onTimeout' ? boom : () => schulte(), destroy() {}
      };
    } });
    run.host.startPreparing(); env.advanceTo(3016);
    if (source === 'listener') key(env.document.body, '1');
    if (source === 'onTimeout') env.advanceTo(123000);
    assert.equal(run.host.state, 'aborted'); assert.equal(run.aborts.length, 1);
    assert.ok(env.errors.length > 0); assertNoResults(run); assertClean(run);
    env.advanceTo(200000); assertNoResults(run);
  });
}

for (const [name, metrics] of [
  ['null', null], ['undefined', undefined], ['array', []], ['missing fields', {}],
  ['fractional progress', schulte({ progress: 0.5 })], ['inconsistent completion', schulte({ completed: true })],
  ['nonfinite nested trial', schulte({ trials: [{ rtMs: Infinity }] })], ['promise', Promise.resolve(schulte())]
]) {
  for (const trigger of ['finish', 'timeout']) {
    test('invalid ' + name + ' metrics from ' + trigger + ' cause technical abort, not a result', () => {
      const env = environment(), run = controlled(env, { timeout: () => metrics }).start();
      if (trigger === 'finish') run.ctx.finish('completed', metrics); else env.advanceTo(123000);
      assert.equal(run.host.state, 'aborted'); assert.equal(run.aborts.length, 1); assertNoResults(run); assertClean(run);
    });
  }
}

const naturalOutcomes = { A1: 'lives_exhausted', A2: 'lives_exhausted', A3: 'timeout', D1: 'attempts_exhausted', E2: 'timeout' };
const naturalDurations = { A1: 30000, A2: 17800, A3: 120000, B1: 65000, B2: 68000, B3: 84000,
  C1: 100000, C2: 100000, C3: 100000, D2: 42000, D3: 30000, E1: 50000, E2: 120000, E3: 93000, F1: 55000, F2: 60000, F3: 100000 };
const naturalRecords = new Map();
function naturalRecord(id) {
  // Keep schema tests runnable individually with --test-name-pattern as well.
  if (!naturalRecords.has(id)) {
    const env = environment(), run = makeHost(env, id).start(); env.advanceTo(123000);
    assertSaved(run, naturalOutcomes[id] || 'completed'); naturalRecords.set(id, plain(run.records[0]));
  }
  return naturalRecords.get(id);
}
for (const id of ids) {
  test(id + ' no-input terminal path integrates production game/host/scoring/store and survives reload', () => {
    const env = environment(), run = makeHost(env, id).start(); env.advanceTo(123000);
    assertSaved(run, naturalOutcomes[id] || 'completed');
    const record = run.records[0]; naturalRecords.set(id, plain(record));
    assert.equal(record.gameId, id); assert.equal(record.score, 0); assert.equal(record.inputMode, 'pointer');
    assert.equal(record.score, env.M.scoring.game(id, record.metrics));
    assert.equal(run.calls.finish, record.outcome === 'timeout' ? 0 : 1); assert.equal(run.calls.timeoutFinish, 0);
    if (id === 'D1') {
      assert.ok(record.durationMs >= 40160 && record.durationMs <= 60160);
      assert.equal(record.metrics.attempts, 10); assert.equal(record.metrics.penalties, 10); assert.equal(record.metrics.meanRtMs, null);
    } else assert.equal(record.durationMs, naturalDurations[id]);
    if (env.M.scoring.denominators[id]) {
      assert.equal(record.metrics.correct, 0); assert.equal(record.metrics.missed, env.M.scoring.denominators[id]);
    }
    const restored = env.M.storage.create(env.disk);
    assert.equal(restored.persistent, true); assert.deepEqual(plain(restored.data), plain(env.M.store.data));
    env.advanceTo(250000); assert.equal(run.records.length, 1); assert.equal(env.rootWrites().length, 1);
  });

  test(id + ' forced global timeout returns synchronous metrics without calling finish or submitting twice', () => {
    const env = environment(), run = makeHost(env, id).start();
    env.jumpTo(123000); env.advanceTo(123000);
    assertSaved(run, 'timeout'); assert.equal(run.calls.timeout, 1); assert.equal(run.calls.finish, 0); assert.equal(run.calls.timeoutFinish, 0);
    assert.equal(typeof run.timeoutReturns[0]?.then, 'undefined'); assert.equal(run.records[0].durationMs, 120000);
    const before = env.scheduled(), original = plain(run.records[0].metrics);
    assert.deepEqual(plain(run.session.onTimeout()), original, 'onTimeout must be repeatable after cleanup');
    assert.deepEqual(plain(run.session.onTimeout()), original); assert.equal(env.scheduled(), before);
    run.elements.container.querySelectorAll('button').forEach(pointer); key(env.document.body, '1');
    env.advanceTo(250000); assert.equal(env.rootWrites().length, 1); assert.equal(run.records.length, 1);
  });

  test(id + ' aborted/destroyed session callbacks cannot affect or write into a replay', () => {
    const env = environment(), old = makeHost(env, id).start();
    const timers = [...env.timers.values()].map(timer => timer.fn), listeners = env.listeners();
    old.host.abort('leave game'); assertClean(old); assertNoResults(old);
    const replay = makeHost(env, id, { elements: old.elements }).start(), text = replay.elements.container.textContent;
    const scheduled = env.scheduled(), listenerCount = env.listeners().length;
    timers.forEach(fn => fn()); listeners.forEach(({ target, type, fn }) => fn(event(target, type, { key: '1' })));
    old.ctx.finish('completed', schulte()); old.host.startPreparing();
    assert.equal(replay.host.state, 'running'); assert.equal(replay.elements.container.textContent, text);
    assert.equal(env.scheduled(), scheduled); assert.equal(env.listeners().length, listenerCount); assertNoResults(replay);
    env.advanceTo(126000); assertSaved(replay, naturalOutcomes[id] || 'completed'); assert.equal(old.records.length, 0);
  });
}

test('finished host callbacks remain inert while another session reuses its container', () => {
  const env = environment(), old = controlled(env, { start(ctx) {
    ctx.schedule(() => ctx.finish('timeout', schulte()), 10000);
    ctx.frame(() => ctx.finish('timeout', schulte()));
    ctx.listen(env.document, 'keydown', () => ctx.finish('timeout', schulte()));
  } }).start();
  const callbacks = [...env.timers.values()].map(timer => timer.fn), listeners = env.listeners();
  old.ctx.finish('completed', schulte({ completed: true, progress: 25, durationMs: 0 })); assertSaved(old, 'completed');
  const replay = makeHost(env, 'E2', { elements: old.elements }).start();
  callbacks.forEach(fn => fn()); listeners.forEach(({ target, type, fn }) => fn(event(target, type, { key: 'Enter' })));
  old.ctx.finish('timeout', schulte()); old.host.abort('obsolete'); old.host.startPreparing();
  assert.equal(replay.host.state, 'running'); assert.equal(replay.records.length, 0); assert.equal(env.rootWrites().length, 1);
  env.advanceTo(126000);
  assert.equal(replay.records.length, 1); assert.equal(replay.records[0].outcome, 'timeout');
  assert.equal(env.rootWrites().length, 2); assert.equal(env.M.store.data.games.E2.history.length, 2);
  assert.notEqual(replay.records[0].sessionId, old.records[0].sessionId); assertClean(replay);
});

test('destroyed shared-quiz sessions cannot be directly restarted into a replay UI', () => {
  // This exercises the session lifecycle contract separately from host-owned
  // stale callbacks above. The normal host does not call start after destroy.
  const restarted = [];
  for (const id of ['B1', 'B2', 'B3', 'C1', 'C2', 'C3']) {
    const env = environment(), old = makeHost(env, id).start(); old.host.abort('leave');
    const replay = makeHost(env, id, { elements: old.elements }).start();
    const children = [...replay.elements.container.children], scheduled = env.scheduled(), listeners = env.listeners().length;
    old.session.start();
    if (children.some((child, i) => replay.elements.container.children[i] !== child) || env.scheduled() !== scheduled || env.listeners().length !== listeners) restarted.push(id);
    assert.equal(env.rootWrites().length, 0);
  }
  assert.deepEqual(restarted, [], 'destroyed sessions must not reconstruct UI or register new resources');
});

test('settings persist and reload without counting practice; invalid settings leave data unchanged', () => {
  const env = environment(), { M } = env;
  assert.deepEqual(plain(M.store.data.settings), { sound: false, reducedMotion: 'system' });
  assert.equal(M.store.settings({ sound: true }), true); assert.equal(M.store.settings({ reducedMotion: 'on' }), true);
  assert.equal(M.store.data.revision, 2); assert.equal(M.store.data.streak.totalDays, 0); assert.deepEqual(plain(M.store.data.games), {});
  const restored = M.storage.create(env.disk); assert.equal(restored.persistent, true);
  assert.deepEqual(plain(restored.data.settings), { sound: true, reducedMotion: 'on' });
  const before = plain(M.store.data), raw = env.disk.getItem(M.storage.KEY), writes = env.rootWrites().length;
  for (const patch of [{ sound: 1 }, { sound: 'true' }, { reducedMotion: 'auto' }, { reducedMotion: null }]) assert.throws(() => M.store.settings(patch), /设置无效/);
  assert.deepEqual(plain(M.store.data), before); assert.equal(env.disk.getItem(M.storage.KEY), raw); assert.equal(env.rootWrites().length, writes);
});

for (const at of ['before preparation', 'during running']) {
  test('settings conflict ' + at + ' preserves other-tab bytes and keeps host result in memory only', () => {
    const env = environment(), other = env.M.storage.create(env.disk), run = makeHost(env);
    if (at === 'during running') run.start();
    assert.equal(other.settings({ sound: true, reducedMotion: 'off' }), true);
    const external = env.disk.getItem(env.M.storage.KEY), writes = env.rootWrites().length;
    if (at === 'before preparation') { run.start(); assert.equal(env.M.store.persistent, false); }
    env.advanceTo(123000);
    assert.equal(run.host.state, 'finished'); assert.equal(run.records.length, 1); assert.equal(run.results[0].saved, false);
    assert.equal(env.M.store.persistent, false); assert.ok(env.M.store.reason);
    assert.equal(env.disk.getItem(env.M.storage.KEY), external); assert.equal(env.rootWrites().length, writes);
    assert.equal(env.M.store.data.games.E2.history.length, 1);
    assert.equal(env.M.store.settings({ reducedMotion: 'on' }), false);
    assert.equal(env.disk.getItem(env.M.storage.KEY), external); assertClean(run);
  });
}

test('external clear notification permanently stops this store from writing', () => {
  const env = environment(); env.M.store.settings({ sound: true });
  env.disk.removeItem(env.M.storage.KEY); env.M.store.externalChange();
  assert.equal(env.M.store.settings({ reducedMotion: 'off' }), false);
  assert.equal(env.disk.getItem(env.M.storage.KEY), null); assert.equal(env.M.store.persistent, false);
  const run = makeHost(env).start(); env.advanceTo(123000);
  assert.equal(run.records.length, 1); assert.equal(run.results[0].saved, false); assert.equal(env.disk.getItem(env.M.storage.KEY), null);
});

test('quota error preserves previous persistent settings while host finishes with an in-memory result', () => {
  const env = environment(); env.M.store.settings({ sound: true });
  const raw = env.disk.getItem(env.M.storage.KEY); env.disk.setItem = () => { throw new Error('quota'); };
  const run = makeHost(env).start(); env.advanceTo(123000);
  assert.equal(run.host.state, 'finished'); assert.equal(run.results[0].saved, false); assert.equal(run.aborts.length, 0);
  assert.equal(env.M.store.data.games.E2.history.length, 1); assert.equal(env.disk.getItem(env.M.storage.KEY), raw); assertClean(run);
});

function sampleRecord(env) {
  return { sessionId: 'schema-example', gameId: 'E2', rulesVersion: '1', contentVersion: '1', outcome: 'timeout', score: 0,
    metrics: schulte(), completedAt: '2026-11-22T12:00:00.000Z', localDay: '2026-11-22', utcOffsetMinutes: 0,
    durationMs: 120000, inputMode: 'pointer', rngSeed: 'schema-seed' };
}

test('storage rejects malformed records without mutating memory or disk', () => {
  const env = environment(), record = sampleRecord(env);
  assert.equal(env.M.storage.validRecord(record, 'E2'), true);
  const patches = [{ sessionId: '' }, { rulesVersion: 'bad/version' }, { contentVersion: null }, { outcome: 'aborted' },
    { score: 101 }, { score: 1 }, { completedAt: 'yesterday' }, { localDay: '2026-02-30' }, { utcOffsetMinutes: 841 },
    { durationMs: -1 }, { durationMs: 120001 }, { durationMs: Infinity }, { inputMode: 'mouse' }, { rngSeed: {} },
    { metrics: schulte({ progress: 26 }) }, { metrics: schulte({ errors: -1 }) }, { metrics: schulte({ trials: {} }) },
    { metrics: schulte({ trials: [NaN] }) }, { metrics: schulte({ extra: JSON.parse('{"constructor":{}}') }) }];
  const before = plain(env.M.store.data);
  for (const patch of patches) {
    assert.equal(env.M.storage.validRecord({ ...record, ...patch }, 'E2'), false, Object.keys(patch).join(','));
    assert.throws(() => env.M.store.save({ ...record, ...patch }), /校验失败/);
    assert.deepEqual(plain(env.M.store.data), before); assert.equal(env.rootWrites().length, 0);
  }
});

test('malformed/newer persisted schemas are preserved verbatim and not silently overwritten', () => {
  const env = environment(); env.M.store.save(sampleRecord(env)); const valid = plain(env.M.store.data);
  const changes = [data => { data.schemaVersion = 2; }, data => { data.revision = -1; },
    data => { data.settings.sound = 'false'; }, data => { data.settings.reducedMotion = 'auto'; },
    data => { data.streak.current = 2; data.streak.longest = 1; }, data => { data.streak.lastLocalDay = '2026-02-30'; },
    data => { data.games.UNKNOWN = data.games.E2; }, data => { data.games.E2.history.push(plain(data.games.E2.history[0])); },
    data => { data.games.E2.statsByRulesVersion['1'].completedCount = 0; }, data => { data.games.E2.history[0].score = 100; },
    data => { data.games.E2.history = Array.from({ length: 101 }, () => plain(data.games.E2.history[0])); }];
  const malformed = changes.map(change => { const value = plain(valid); change(value); assert.equal(env.M.storage.validate(value), false); return JSON.stringify(value); });
  for (const raw of ['{bad json', ...malformed]) {
    const disk = backend(raw), store = env.M.storage.create(disk);
    assert.equal(store.persistent, false); assert.equal(store.raw, raw); assert.equal(disk.getItem(env.M.storage.KEY), raw);
    assert.equal(store.save({ ...sampleRecord(env), sessionId: 'memory-result' }).saved, false);
    assert.equal(store.data.games.E2.history.length, 1); assert.equal(disk.getItem(env.M.storage.KEY), raw);
    assert.equal(disk.writes.filter(write => write.key === env.M.storage.KEY).length, 0);
  }
});

// Regression assertions below intentionally reject malformed data even if the
// current validator accepts it. Do not turn these into TODOs or acceptance tests.
const requiredMetrics = {
  A1: ['maxCorrectCells', 'correctRounds', 'errors', 'livesRemaining', 'trials'], A2: ['maxLength', 'errors', 'trials'],
  A3: ['matchedPairs', 'moves', 'durationMs', 'layout'],
  B1: ['correct', 'missed', 'meanCorrectMs', 'trials'], B2: ['correct', 'missed', 'meanCorrectMs', 'trials'], B3: ['correct', 'missed', 'meanCorrectMs', 'trials'],
  C1: ['correct', 'missed', 'meanCorrectMs', 'trials'], C2: ['correct', 'missed', 'meanCorrectMs', 'trials'], C3: ['correct', 'missed', 'meanCorrectMs', 'trials'],
  D1: ['reactionTimes', 'meanRtMs', 'medianRtMs', 'penalties', 'attempts', 'trials'], D2: ['correct', 'missed', 'meanCorrectMs', 'trials'],
  D3: ['hits', 'misses', 'errors', 'meanHitMs', 'trials', 'targets'], E1: ['correct', 'matchCorrect', 'nonmatchCorrect', 'missed', 'trials', 'sequence'],
  E2: ['completed', 'progress', 'errors', 'durationMs', 'layout'], E3: ['correct', 'meanCorrectMs', 'trials'],
  F1: ['correct', 'missed', 'meanCorrectMs', 'trials'], F2: ['correct', 'missed', 'trials'], F3: ['correct', 'missed', 'meanCorrectMs', 'trials']
};
for (const id of ids) {
  test(id + ' schema requires all production metrics fields, not only the score numerator', () => {
    const env = environment(), record = naturalRecord(id);
    assert.ok(record, 'natural terminal integration must have produced a valid baseline');
    const accepted = [];
    for (const field of requiredMetrics[id]) {
      const metrics = plain(record.metrics); delete metrics[field];
      if (env.M.storage.validateMetrics(id, metrics)) accepted.push(field);
    }
    assert.deepEqual(accepted, [], 'missing required fields were accepted for ' + id);
  });
}

const invalidMetricsCases = [
  ['B1', 'negative missed count', metrics => { metrics.missed = -1; }],
  ['B1', 'fractional missed count', metrics => { metrics.missed = 0.5; }],
  ['B1', 'over-denominator missed count', metrics => { metrics.missed = 11; }],
  ['B1', 'mean with no correct trials', metrics => { metrics.meanCorrectMs = 100; }],
  ['B1', 'invalid trial entries', metrics => { metrics.trials = ['not a trial']; }],
  ['A1', 'inconsistent lives and errors', metrics => { metrics.livesRemaining = 3; }],
  ['A3', 'invalid pair layout', metrics => { metrics.layout = [1]; }],
  ['D1', 'numeric-string reaction sample', metrics => { Object.assign(metrics, { reactionTimes: ['300'], penalties: 0, attempts: 1, meanRtMs: 300, medianRtMs: 300 }); }],
  ['D1', 'median without any sample', metrics => { metrics.medianRtMs = 300; }],
  ['D1', 'mean inconsistent with samples', metrics => { Object.assign(metrics, { reactionTimes: [300], penalties: 0, attempts: 1, meanRtMs: 0, medianRtMs: 300 }); }],
  ['D3', 'mean without any hit', metrics => { metrics.meanHitMs = 100; }],
  ['E1', 'inconsistent correct subtotals', metrics => { metrics.matchCorrect = 8; }],
  ['E2', 'layout not a permutation of 1 to 25', metrics => { metrics.layout = Array(25).fill(1); }],
  ['F2', 'incorrect total missed count', metrics => { metrics.missed = 6; }]
];
for (const [id, name, mutate] of invalidMetricsCases) {
  test('schema rejects ' + id + ' ' + name + ' before host persistence', () => {
    const env = environment(), baseline = naturalRecord(id); assert.ok(baseline);
    const metrics = plain(baseline.metrics); mutate(metrics);
    assert.equal(env.M.storage.validateMetrics(id, metrics), false, name);
    const record = { ...baseline, metrics, score: env.M.scoring.game(id, metrics) };
    assert.equal(env.M.storage.validRecord(record, id), false);
    assert.throws(() => env.M.store.save(record), /校验失败/); assert.equal(env.rootWrites().length, 0);
  });
}

test('host treats incomplete denominator-game metrics as technical failure, not a scored result', () => {
  const env = environment(), run = makeHost(env, 'B1', { createSession(ctx) {
    return { start() { ctx.finish('completed', { correct: 0 }); }, onTimeout: () => ({ correct: 0 }), destroy() {} };
  } }).start();
  assert.equal(run.host.state, 'aborted'); assert.equal(run.aborts.length, 1); assertNoResults(run); assertClean(run);
});
