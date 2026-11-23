'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const scripts = ['js/core/random.js', 'js/core/ui.js', 'js/games/attention.js', 'js/games/calculation.js']
  .map(file => ({ file, source: fs.readFileSync(path.join(root, file), 'utf8') }));
const plain = value => JSON.parse(JSON.stringify(value));
const ids = ['E1', 'E2', 'E3', 'F1', 'F2', 'F3'];
// Small independently known fixtures: production data/solver belongs to the source module.
const pool = [
  { id: 'yes-a', cards: [1, 2, 3, 4], solvable: true, expression: '(1+2+3)*4' },
  { id: 'yes-b', cards: [1, 1, 4, 6], solvable: true, expression: '(1-1+4)*6' },
  { id: 'yes-c', cards: [3, 3, 8, 8], solvable: true, expression: '8/(3-8/3)' },
  { id: 'yes-d', cards: [1, 3, 4, 6], solvable: true, expression: '6/(1-3/4)' },
  { id: 'yes-e', cards: [2, 2, 6, 6], solvable: true, expression: '6*2+6*2' },
  ...[1, 2, 3, 4, 5].map(n => ({ id: 'no-' + n, cards: [1, 1, 1, n], solvable: false, expression: null }))
];

class Element {
  constructor(tag, ownerDocument) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = ownerDocument;
    this.parentNode = null; this.children = []; this.handlers = new Map();
    this.attributes = new Map(); this.dataset = {}; this.className = ''; this.disabled = false;
    this.tabIndex = -1; this._text = ''; this.style = { setProperty: (key, value) => { this.style[key] = String(value); } };
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
  get isConnected() { return this.tagName === '#DOCUMENT' || Boolean(this.parentNode && this.parentNode.isConnected); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(); this._text = String(value); }
  append(...nodes) {
    nodes.forEach(node => {
      if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node);
      node.parentNode = this; this.children.push(node);
    });
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => node.parentNode = null); this.children = []; this._text = ''; this.append(...nodes);
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  focus() { this.ownerDocument.activeElement = this; }
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
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function environment() {
  const document = new Element('#document'); document.ownerDocument = document;
  document.createElement = tag => new Element(tag, document);
  document.body = document.createElement('body'); document.append(document.body); document.activeElement = document.body;
  const sandbox = { document, console }; sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(scripts[0].source, context, { filename: scripts[0].file });
  const M = sandbox.MindOrbit;
  M.catalog = Object.fromEntries(ids.map(id => [id, { id, name: id }]));
  M.scoring = { game: () => 0 }; M.generators = { external: 'preserved' };
  scripts.slice(1).forEach(({ source, file }) => vm.runInContext(source, context, { filename: file }));
  return { M, document, context, sandbox };
}

function dispatch(target, type, properties = {}) {
  const event = { target, type, button: 0, detail: 0, repeat: false, altKey: false, ctrlKey: false, metaKey: false,
    defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
  for (let current = target; current; current = current.parentNode) {
    event.currentTarget = current;
    for (const handler of [...(current.handlers.get(type) || [])]) handler(event);
  }
  return event;
}
function key(target, value, properties = {}) {
  const event = dispatch(target, 'keydown', { key: value, ...properties });
  // Native button activation; games must not add a second custom Enter handler.
  if (value === 'Enter' && !event.defaultPrevented && target.tagName === 'BUTTON' && !target.disabled) {
    dispatch(target, 'click', { detail: 0 });
  }
  return event;
}
function pointer(button) {
  dispatch(button, 'pointerdown');
  dispatch(button, 'click', { detail: 1 });
}

function runGame(id, options = {}) {
  const { M, document } = environment();
  if (options.pool !== false) M.twentyFour = plain(options.pool || pool);
  let now = 0, nextTimer = 0, scheduled = 0, session;
  const timers = new Map(), registrations = new Set(), finishes = [], aborts = [], statuses = [], stages = [];
  const container = document.createElement('main'); document.body.append(container);
  const ctx = {
    container, rng: M.random(options.seed || 'session'), sessionDeadline: 0,
    now: () => now, elapsed: () => now,
    schedule(fn, delay) { const id = ++nextTimer; scheduled++; timers.set(id, { fn, at: now + Math.max(0, delay) }); return id; },
    cancel(id) { timers.delete(id); },
    frame(fn) { return ctx.schedule(fn, 16); },
    listen(target, event, fn) {
      if (!target.handlers.has(event)) target.handlers.set(event, new Set());
      target.handlers.get(event).add(fn);
      const entry = { target, event, fn }; registrations.add(entry);
      // The real host returns the listener, NOT an unsubscribe callback.
      return fn;
    },
    finish(outcome, metrics) { finishes.push({ outcome, metrics }); },
    abort(message) { aborts.push(message); },
    setStatus(text) { statuses.push(text); }, setStage(stage) { stages.push(stage); },
    setProgress(current, total) { ctx.progress = [current, total]; },
    setRemaining(deadline) { ctx.remaining = deadline; }
  };
  // Mimic the host: sessionDeadline is assigned after createSession, before start.
  session = M.games[id].createSession(ctx); ctx.sessionDeadline = options.deadline || 120000;
  const advanceTo = target => {
    assert.ok(target >= now, 'clock cannot move backwards');
    let count = 0;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++count < 10000, 'no runaway scheduling');
      timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].fn();
    }
    now = target;
  };
  const run = { M, document, ctx, container, session, timers, registrations, finishes, aborts, statuses, stages,
    advanceTo, jumpTo(target) { assert.ok(target >= now); now = target; },
    drain() { advanceTo(now); }, now: () => now, scheduled: () => scheduled,
    buttons: () => container.querySelectorAll('button'),
    digit: () => container.querySelector('.digit-display'),
    timeout() { const before = scheduled; const result = session.onTimeout(); assert.equal(scheduled, before); assert.equal(finishes.length, 0); return plain(result); }
  };
  if (options.start !== false) session.start();
  return run;
}

function validOptions(options, answer, min, max) {
  assert.equal(options.length, 4); assert.equal(new Set(options).size, 4);
  assert.equal(options.filter(n => n === answer).length, 1);
  options.forEach(n => assert.ok(Number.isInteger(n) && n >= min && n <= max));
}

const env = environment();
test('classic scripts register six games and preserve unrelated namespace entries', () => {
  assert.deepEqual(Object.keys(env.M.games).sort(), ids);
  assert.equal(env.M.generators.external, 'preserved');
  for (const { source } of scripts.slice(2)) {
    assert.doesNotMatch(source, /\b(?:setTimeout|setInterval|requestAnimationFrame|addEventListener|fetch|XMLHttpRequest|localStorage)\b/);
  }
});

test('E1 and E2 generators are deterministic and satisfy exact quotas and permutations across 200 seeds', () => {
  for (let seed = 0; seed < 200; seed++) {
    const sequence = env.M.generators.E1(env.M.random(seed));
    assert.equal(sequence.length, 25);
    assert.ok(sequence.every(n => Number.isInteger(n) && n >= 0 && n <= 9));
    assert.equal(sequence.filter((n, i) => i >= 2 && n === sequence[i - 2]).length, 8);
    assert.equal(sequence.filter((n, i) => i >= 2 && n !== sequence[i - 2]).length, 15);
    assert.deepEqual(plain(sequence), plain(env.M.generators.E1(env.M.random(seed))));
    const layout = env.M.generators.E2(env.M.random(seed));
    assert.deepEqual(plain([...layout].sort((a, b) => a - b)), Array.from({ length: 25 }, (_, i) => i + 1));
    assert.deepEqual(plain(layout), plain(env.M.generators.E2(env.M.random(seed))));
  }
});

test('E3 has the six column-by-row sizes and exactly one opposite-direction target', () => {
  const opposites = { '↑': '↓', '↓': '↑', '←': '→', '→': '←' };
  const positions = new Set();
  for (let seed = 0; seed < 150; seed++) {
    const rounds = env.M.generators.E3(env.M.random(seed));
    assert.deepEqual(plain(rounds.map(r => [r.columns, r.rows])), [[3, 3], [3, 4], [4, 4], [4, 5], [5, 5], [5, 6]]);
    assert.deepEqual(plain(rounds), plain(env.M.generators.E3(env.M.random(seed))));
    rounds.forEach(r => {
      assert.equal(r.symbols.length, r.columns * r.rows); assert.equal(r.target, opposites[r.regular]);
      assert.equal(r.symbols.filter(s => s !== r.regular).length, 1);
      assert.equal(r.symbols[r.targetIndex], r.target); assert.ok(r.columns <= 5);
    });
    positions.add(rounds[0].targetIndex);
  }
  assert.equal(positions.size, 9);
});

test('F1 generates exact operator quotas, legal arithmetic and four unique bounded options', () => {
  for (let seed = 0; seed < 150; seed++) {
    const questions = env.M.generators.F1(env.M.random(seed)), counts = { '+': 0, '-': 0, '*': 0, '/': 0 }, seen = new Set();
    assert.equal(questions.length, 10);
    assert.deepEqual(plain(questions), plain(env.M.generators.F1(env.M.random(seed))));
    questions.forEach(q => {
      const { left: a, right: b, operator: op, result } = q.record; counts[op]++;
      const key = op + ':' + (op === '+' || op === '*' ? [a, b].sort((x, y) => x - y).join(',') : [a, b].join(','));
      assert.ok(!seen.has(key)); seen.add(key);
      if (op === '+') { assert.ok(a >= 0 && a <= 50 && b >= 0 && b <= 50); assert.equal(result, a + b); }
      if (op === '-') { assert.ok(a >= b && a <= 100 && b >= 0); assert.equal(result, a - b); }
      if (op === '*') { assert.ok(a >= 2 && a <= 9 && b >= 2 && b <= 9); assert.equal(result, a * b); }
      if (op === '/') { assert.ok(b >= 2 && b <= 9 && result >= 1 && result <= 9); assert.equal(a % b, 0); assert.equal(result, a / b); }
      validOptions(q.options, result, 0, 100); assert.equal(q.options[q.answer], result);
      q.options.filter(n => n !== result).forEach(n => assert.ok([1, 2, 5, 10].includes(Math.abs(n - result))));
    });
    assert.deepEqual(counts, { '+': 3, '-': 3, '*': 2, '/': 2 });
  }
});

test('F2 lengths, raw repeated numbers, sums and distractor bounds hold, including both extremes', () => {
  for (let seed = 0; seed < 200; seed++) {
    const rounds = env.M.generators.F2(env.M.random(seed));
    assert.deepEqual(plain(rounds), plain(env.M.generators.F2(env.M.random(seed))));
    rounds.forEach((r, i) => {
      assert.equal(r.sequence.length, i + 3); assert.ok(r.sequence.every(n => Number.isInteger(n) && n >= 1 && n <= 9));
      assert.equal(r.total, r.sequence.reduce((a, b) => a + b, 0));
      validOptions(r.options, r.total, i + 3, 9 * (i + 3)); assert.equal(r.options[r.answer], r.total);
    });
  }
  for (const high of [false, true]) {
    const rng = { int: (min, max) => high ? max : min, pick: array => array[0], shuffle: array => [...array],
      sample: (array, count) => high ? array.slice(-count) : array.slice(0, count) };
    env.M.generators.F2(rng).forEach(r => {
      assert.ok(r.sequence.every(n => n === (high ? 9 : 1)));
      assert.equal(r.total, r.sequence.length * (high ? 9 : 1));
      validOptions(r.options, r.total, r.sequence.length, 9 * r.sequence.length);
    });
    env.M.generators.F1(rng).forEach(q => validOptions(q.options, q.record.result, 0, 100));
  }
});

test('F3 samples four unique solvable and four unique unsolvable questions without mutating data', () => {
  const original = plain(pool);
  for (let seed = 0; seed < 150; seed++) {
    const questions = env.M.generators.F3(env.M.random(seed), pool);
    assert.equal(questions.length, 8); assert.equal(questions.filter(q => q.record.solvable).length, 4);
    assert.equal(new Set(questions.map(q => [...q.record.cards].sort().join(','))).size, 8);
    assert.equal(new Set(questions.map(q => q.id)).size, 8);
    assert.deepEqual(plain(questions), plain(env.M.generators.F3(env.M.random(seed), pool)));
    questions.forEach(q => {
      assert.equal(q.answer, q.record.solvable ? 0 : 1);
      if (q.record.solvable) assert.ok(q.explanation.includes(q.record.expression));
      else assert.ok(q.explanation.includes('穷举无解'));
    });
  }
  assert.deepEqual(pool, original);
  const questions = env.M.generators.F3(env.M.random('copy'), pool); questions[0].record.cards[0] = 99;
  assert.deepEqual(pool, original);
});

test('F3 fails before start for missing, insufficient, malformed or duplicate content', () => {
  assert.throws(() => runGame('F3', { pool: false }), /题库未就绪/);
  const rng = () => env.M.random('invalid');
  assert.throws(() => env.M.generators.F3(rng(), pool.slice(0, 5)), /不足/);
  assert.throws(() => env.M.generators.F3(rng(), [...pool, { ...pool[0], id: 'duplicate-cards' }]), /重复/);
  assert.throws(() => env.M.generators.F3(rng(), [...pool, { ...pool[0], cards: [2, 3, 4, 5] }]), /重复/);
  for (const row of [{ ...pool[0], cards: [0, 2, 3, 4] }, { ...pool[0], expression: null }, { ...pool[5], expression: 'fake' }]) {
    assert.throws(() => env.M.generators.F3(rng(), [row, ...pool.slice(1)]), /格式异常/);
  }
});

test('E1 runs 25 absolute slots, locks answers, permits blank-period answers and excludes warmup', () => {
  const run = runGame('E1'), expected = run.M.generators.E1(run.M.random('session'));
  for (let i = 0; i < 25; i++) {
    run.advanceTo(i * 2000); assert.equal(run.digit().textContent, String(expected[i]));
    assert.equal(run.ctx.remaining, (i + 1) * 2000);
    if (i < 2) {
      assert.ok(run.buttons().every(b => b.disabled)); pointer(run.buttons()[0]); key(run.document.body, '1');
    }
    run.advanceTo(i * 2000 + 599); assert.equal(run.digit().textContent, String(expected[i]));
    run.advanceTo(i * 2000 + 600); assert.equal(run.digit().textContent, '');
    if (i >= 2) {
      const answer = expected[i] === expected[i - 2] ? 0 : 1;
      key(run.document.body, String(2 - answer), { repeat: true });
      key(run.document.body, String(answer + 1)); pointer(run.buttons()[1 - answer]);
      assert.equal(run.statuses.at(-1), '已作答'); assert.equal(run.container.querySelector('.game-feedback'), null);
    }
  }
  run.advanceTo(50000); assert.equal(run.finishes.length, 1); assert.equal(run.now(), 50000);
  const m = plain(run.finishes[0].metrics);
  assert.equal(m.correct, 23); assert.equal(m.matchCorrect, 8); assert.equal(m.nonmatchCorrect, 15); assert.equal(m.missed, 0);
  assert.equal(m.trials.length, 25); assert.ok(m.trials.slice(0, 2).every(t => t.answer === null && t.correct === null && t.rtMs === null));
  assert.ok(m.trials.slice(2).every(t => t.rtMs === 600));
  assert.deepEqual(m.trials.map(t => t.presentedAtMs), Array.from({ length: 25 }, (_, i) => i * 2000));
  run.advanceTo(120000); assert.equal(run.finishes.length, 1); assert.equal(run.timers.size, 0);
});

test('E1 always-different strategy scores only 15 and missing responses remain null', () => {
  const run = runGame('E1');
  for (let i = 2; i < 25; i++) { run.advanceTo(i * 2000 + 1); pointer(run.buttons()[1]); }
  run.advanceTo(50000); const m = run.finishes[0].metrics;
  assert.equal(m.correct, 15); assert.equal(m.matchCorrect, 0); assert.equal(m.nonmatchCorrect, 15);
  const silent = runGame('E1'); silent.advanceTo(50000);
  assert.equal(silent.finishes[0].metrics.missed, 23);
  assert.ok(silent.finishes[0].metrics.trials.every(t => t.answer === null && t.rtMs === null));
});

test('E1 deadline events cannot answer the expired slot; delays over 250 ms abort without catchup', () => {
  const boundary = runGame('E1'); boundary.advanceTo(4000); boundary.jumpTo(6000); pointer(boundary.buttons()[0]); boundary.drain();
  const metrics = boundary.timeout(); assert.equal(metrics.trials[2].answer, null); assert.equal(metrics.trials[3].answer, null);
  for (const late of [251, 2001]) {
    const run = runGame('E1'); run.advanceTo(600); run.jumpTo(2000 + late); run.drain();
    assert.equal(run.aborts.length, 1); assert.equal(run.finishes.length, 0); assert.equal(run.timers.size, 0);
    assert.deepEqual(run.ctx.progress, [1, 25]); run.advanceTo(60000); assert.equal(run.aborts.length, 1);
  }
  const allowed = runGame('E1'); allowed.advanceTo(600); allowed.jumpTo(2250); allowed.drain();
  assert.equal(allowed.aborts.length, 0); assert.deepEqual(allowed.ctx.progress, [2, 25]);
  allowed.advanceTo(2600); assert.equal(allowed.digit().textContent, ''); allowed.session.destroy();
});

test('E2 preserves layout, counts wrong and already-completed cells, supports arrows and native Enter', () => {
  const run = runGame('E2'), cells = run.buttons(), layout = cells.map(b => Number(b.textContent));
  assert.equal(cells.filter(b => b.tabIndex === 0).length, 25);
  assert.deepEqual(cells.map(cell => Number(cell.dataset.index)), Array.from({ length: 25 }, (_, i) => i));
  cells[0].focus(); key(cells[0], 'ArrowRight'); assert.equal(run.document.activeElement, cells[1]);
  key(cells[1], 'ArrowDown'); assert.equal(run.document.activeElement, cells[6]);
  key(cells[6], 'ArrowLeft'); assert.equal(run.document.activeElement, cells[5]);
  key(cells[5], 'ArrowUp'); assert.equal(run.document.activeElement, cells[0]);
  pointer(cells[layout.indexOf(25)]); assert.ok(cells[layout.indexOf(25)].classList.contains('is-wrong'));
  run.advanceTo(250); assert.ok(!cells[layout.indexOf(25)].classList.contains('is-wrong'));
  pointer(cells[layout.indexOf(1)]); pointer(cells[layout.indexOf(1)]);
  assert.ok(cells[layout.indexOf(1)].classList.contains('matched')); assert.equal(cells[layout.indexOf(1)].disabled, false);
  cells[layout.indexOf(2)].focus(); key(cells[layout.indexOf(2)], 'Enter', { repeat: true });
  assert.deepEqual(run.ctx.progress, [1, 25]); key(cells[layout.indexOf(2)], 'Enter'); assert.deepEqual(run.ctx.progress, [2, 25]);
  run.advanceTo(1000);
  for (let n = 3; n <= 25; n++) pointer(cells[layout.indexOf(n)]);
  assert.equal(run.finishes.length, 1); const m = plain(run.finishes[0].metrics);
  assert.deepEqual(m, { completed: true, progress: 25, errors: 2, durationMs: 1000, layout });
  assert.deepEqual(cells.map(b => Number(b.textContent)), layout);
  pointer(cells[layout.indexOf(25)]); assert.equal(run.finishes.length, 1);
});

test('E2 treats the exact 120-second boundary as timeout and clamps delayed duration', () => {
  for (const time of [120000, 122000]) {
    const run = runGame('E2'); const cells = run.buttons();
    for (let n = 1; n <= 24; n++) pointer(cells.find(b => Number(b.textContent) === n));
    run.jumpTo(time); pointer(cells.find(b => Number(b.textContent) === 25));
    const m = run.timeout(); assert.equal(m.completed, false); assert.equal(m.progress, 24); assert.equal(m.durationMs, 120000);
  }
});

test('E3 first wrong click decides the round; six layouts, correct-only mean and stale inputs are safe', () => {
  const run = runGame('E3'), rounds = run.M.generators.E3(run.M.random('session'));
  const stale = run.buttons()[rounds[0].targetIndex];
  for (let i = 0; i < 6; i++) {
    const cells = run.buttons(), round = rounds[i];
    assert.equal(cells.length, round.columns * round.rows);
    assert.equal(run.container.querySelector('.game-grid').style['--columns'], String(round.columns));
    run.advanceTo(run.now() + 100);
    if (i === 0) { pointer(cells[(round.targetIndex + 1) % cells.length]); pointer(cells[round.targetIndex]); }
    else { pointer(stale); pointer(cells[round.targetIndex]); }
    assert.equal(run.stages.at(-1), 'feedback'); run.advanceTo(run.now() + 500);
  }
  assert.equal(run.finishes.length, 1); const m = run.finishes[0].metrics;
  assert.equal(m.correct, 5); assert.equal(m.meanCorrectMs, 100); assert.equal(m.trials[0].correct, false);
  assert.ok(m.trials.every(t => t.rtMs === 100));
});

test('E3 rejects exact-deadline answers and all timeouts have a null correct-time mean', () => {
  const run = runGame('E3'); run.jumpTo(15000); pointer(run.buttons()[0]); run.drain();
  assert.equal(run.stages.at(-1), 'feedback'); run.advanceTo(93000);
  assert.equal(run.finishes.length, 1); const m = run.finishes[0].metrics;
  assert.equal(m.correct, 0); assert.equal(m.meanCorrectMs, null); assert.ok(m.trials.every(t => t.answer === null && t.rtMs === null));
});

test('F2 hides choices during every 700+200 ms playback slot and starts a fresh seven-second answer window', () => {
  const run = runGame('F2'), rounds = run.M.generators.F2(run.M.random('session'));
  let stale;
  for (let i = 0; i < 5; i++) {
    const round = rounds[i], began = run.now();
    for (let p = 0; p < round.sequence.length; p++) {
      run.advanceTo(began + p * 900); assert.equal(run.digit().textContent, String(round.sequence[p]));
      assert.equal(run.buttons().length, 0); assert.equal(run.container.querySelector('.answer-options'), null);
      assert.equal(run.container.querySelector('.game-feedback'), null); key(run.document.body, '1');
      if (stale) pointer(stale);
      run.advanceTo(began + p * 900 + 699); assert.equal(run.digit().textContent, String(round.sequence[p]));
      run.advanceTo(began + p * 900 + 700); assert.equal(run.digit().textContent, '');
      run.advanceTo(began + p * 900 + 899); assert.equal(run.buttons().length, 0);
    }
    run.advanceTo(began + round.sequence.length * 900); assert.equal(run.buttons().length, 4);
    assert.equal(run.ctx.remaining, run.now() + 7000); run.advanceTo(run.now() + 123);
    stale = run.buttons()[round.answer]; pointer(stale); key(run.document.body, String((round.answer + 1) % 4 + 1));
    assert.ok(run.container.querySelector('.game-feedback').textContent.includes(round.sequence.join(' + ')));
    run.advanceTo(run.now() + 500);
  }
  assert.equal(run.finishes.length, 1); const m = plain(run.finishes[0].metrics);
  assert.equal(m.correct, 5); assert.equal(m.missed, 0); assert.ok(m.trials.every(t => t.rtMs === 123));
  assert.deepEqual(m.trials.map(t => t.sequence), plain(rounds.map(r => r.sequence)));
});

test('F2 deadline and global timeout do not turn missing responses into measured samples', () => {
  const run = runGame('F2'); run.advanceTo(2700); run.jumpTo(9700); pointer(run.buttons()[0]); run.drain();
  assert.equal(run.stages.at(-1), 'feedback'); const m = run.timeout();
  assert.equal(m.correct, 0); assert.equal(m.missed, 5); assert.ok(m.trials.every(t => t.rtMs === null && t.answer === null));
  const playing = runGame('F2', { deadline: 400 }); playing.jumpTo(400); const partial = playing.timeout();
  assert.equal(partial.missed, 5); assert.equal(playing.buttons().length, 0); assert.equal(playing.timers.size, 0);
  const silent = runGame('F2'); silent.advanceTo(60000);
  assert.equal(silent.finishes.length, 1); assert.equal(silent.finishes[0].metrics.missed, 5);
});

for (const [id, limit, count] of [['F1', 5000, 10], ['F3', 12000, 8]]) {
  test(id + ' uses the generic quiz, records raw stimuli, locks repeats and completes all questions', () => {
    const run = runGame(id), questions = run.M.generators[id](run.M.random('session'));
    let stale;
    for (let i = 0; i < count; i++) {
      assert.equal(run.ctx.remaining, run.now() + limit);
      assert.equal(run.container.querySelector('.game-feedback'), null);
      if (stale) pointer(stale);
      run.advanceTo(run.now() + 175);
      const answer = questions[i].answer;
      key(run.document.body, String((answer + 1) % questions[i].options.length + 1), { repeat: true });
      stale = run.buttons()[answer]; pointer(stale); key(run.document.body, '1');
      assert.ok(run.container.querySelector('.game-feedback').textContent.includes(questions[i].explanation));
      run.advanceTo(run.now() + 500);
    }
    assert.equal(run.finishes.length, 1); const m = plain(run.finishes[0].metrics);
    assert.equal(m.correct, count); assert.equal(m.missed, 0); assert.equal(m.meanCorrectMs, 175);
    assert.deepEqual(m.trials.map(t => t.stimulus), plain(questions.map(q => q.record)));
    run.advanceTo(120000); assert.equal(run.finishes.length, 1);
  });

  test(id + ' exact deadline, unanswered questions and hard cutoff are normalized without finish or schedules', () => {
    const run = runGame(id); run.jumpTo(limit); pointer(run.buttons()[0]);
    const m = run.timeout(); assert.equal(m.correct, 0); assert.equal(m.missed, count); assert.equal(m.meanCorrectMs, null);
    assert.equal(m.trials.length, count); assert.ok(m.trials.every(t => t.answer === null && t.rtMs === null));
    const hard = runGame(id, { deadline: 200 }); hard.jumpTo(200); pointer(hard.buttons()[0]);
    assert.equal(hard.timeout().missed, count);
    const silent = runGame(id); silent.advanceTo((limit + 500) * count);
    assert.equal(silent.finishes.length, 1); assert.equal(silent.finishes[0].metrics.missed, count);
    assert.ok(silent.finishes[0].metrics.trials.every(t => t.rtMs === null));
  });
}

test('all sessions have idempotent start/destroy and no old callback or listener can change the UI', () => {
  for (const id of ids) {
    const run = runGame(id), text = run.container.textContent, pending = [...run.timers.values()].map(t => t.fn), scheduled = run.scheduled();
    run.session.start(); assert.equal(run.scheduled(), scheduled); assert.equal(run.container.textContent, text);
    const buttons = run.buttons(); run.session.destroy(); run.session.destroy(); run.session.start();
    assert.equal(run.timers.size, 0);
    pending.forEach(fn => fn()); buttons.forEach(pointer); key(run.document.body, '1'); run.advanceTo(200000);
    assert.equal(run.container.textContent, text); assert.equal(run.finishes.length, 0); assert.equal(run.aborts.length, 0);
    assert.equal(run.scheduled(), scheduled);
  }
});

test('hard timeout is synchronous, repeatable and freezes all six games without submissions', () => {
  for (const id of ids) {
    const run = runGame(id); run.jumpTo(120000);
    const before = run.scheduled(), metrics = run.timeout();
    assert.deepEqual(run.timeout(), metrics); assert.equal(run.scheduled(), before); assert.equal(run.timers.size, 0);
    run.buttons().forEach(pointer); run.advanceTo(200000);
    assert.equal(run.finishes.length, 0); assert.ok(!JSON.stringify(metrics).includes('NaN'));
  }
});

function actualHost(id, withPool = true) {
  const { M, document, context, sandbox } = environment();
  let now = 0, nextId = 0;
  const timers = new Map(), records = [], aborts = [];
  Object.assign(sandbox, {
    crypto: require('node:crypto').webcrypto, performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++nextId; timers.set(id, { fn, at: now + Math.max(0, delay) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { return sandbox.setTimeout(() => fn(now), 16); },
    cancelAnimationFrame(id) { timers.delete(id); }
  });
  M.store = { checkConflict() {}, save() { return true; } };
  M.storage = { localDay: () => '2026-11-01' };
  if (withPool) M.twentyFour = plain(pool);
  vm.runInContext(fs.readFileSync(path.join(root, 'js/core/game-host.js'), 'utf8'), context, { filename: 'js/core/game-host.js' });
  const elements = Object.fromEntries(['container', 'status', 'progress', 'bar', 'timer', 'total'].map(key => [key, document.createElement('div')]));
  document.body.append(...Object.values(elements));
  const host = M.createHost(M.games[id], elements, { onFinish: record => records.push(record), onAbort: message => aborts.push(message) });
  const advanceTo = target => {
    let count = 0;
    for (;;) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(++count < 20000); timers.delete(next[0]); now = next[1].at; next[1].fn();
    }
    now = target;
  };
  return { host, elements, records, aborts, timers, advanceTo, document, sandbox };
}

test('all six games integrate with the actual host countdown, finish gate and resource cleanup', () => {
  const durations = { E1: 50000, E2: 0, E3: 93000, F1: 55000, F2: 60000, F3: 100000 };
  for (const id of ids) {
    const run = actualHost(id); run.host.startPreparing(); run.advanceTo(3000);
    assert.equal(run.host.state, 'running', id);
    if (id === 'E2') {
      const cells = run.elements.container.querySelectorAll('button');
      for (let n = 1; n <= 25; n++) pointer(cells.find(button => Number(button.textContent) === n));
    } else run.advanceTo(3000 + durations[id]);
    assert.equal(run.host.state, 'finished', id); assert.equal(run.records.length, 1, id);
    assert.equal(run.records[0].outcome, 'completed'); assert.equal(run.aborts.length, 0); assert.equal(run.timers.size, 0);
    assert.ok([...run.document.handlers.values()].every(listeners => listeners.size === 0));
    run.advanceTo(200000); assert.equal(run.records.length, 1);
  }
});

test('the actual host owns hard timeout and aborts unavailable F3 content before preparation', () => {
  const run = actualHost('E2'); run.host.startPreparing(); run.advanceTo(123000);
  assert.equal(run.records.length, 1); assert.equal(run.records[0].outcome, 'timeout');
  assert.equal(run.records[0].metrics.durationMs, 120000); assert.equal(run.records[0].metrics.completed, false);
  assert.equal(run.timers.size, 0);
  const missing = actualHost('F3', false); missing.sandbox.console = { ...console, error() {} };
  missing.host.startPreparing(); assert.equal(missing.host.state, 'aborted');
  assert.equal(missing.aborts.length, 1); assert.equal(missing.records.length, 0); assert.equal(missing.timers.size, 0);
});
