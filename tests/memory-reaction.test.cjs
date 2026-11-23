'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));

// Small DOM and monotonic host: run the real helpers and games without dependencies.
function harness(id, options = {}) {
  let now = 0, nextId = 0, terminal = false, session;
  const queue = new Map(), listeners = new Map();
  const stats = { finishCalls: 0, abortCalls: 0, scheduleCalls: 0, inputEvents: 0 };
  let result = null, abortMessage = null, stage = null, remaining = null;
  const document = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase(); this.children = []; this.parentNode = null;
      this.className = ''; this.dataset = {}; this.attributes = {}; this.disabled = false; this._text = '';
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => { const enabled = force === undefined ? !this.classList.contains(name) : force; this.classList[enabled ? 'add' : 'remove'](name); return enabled; }
      };
    }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    set textContent(value) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this._text = String(value); }
    append(...nodes) { nodes.forEach(node => { if (node.parentNode) node.parentNode.children = node.parentNode.children.filter(child => child !== node); node.parentNode = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    get isConnected() { return this === document.body || Boolean(this.parentNode && this.parentNode.isConnected); }
    focus() { document.activeElement = this; }
    querySelectorAll(selector) {
      const matches = node => selector[0] === '.' ? node.classList.contains(selector.slice(1)) : node.tagName.toLowerCase() === selector;
      const result = [];
      this.children.forEach(node => { if (matches(node)) result.push(node); result.push(...node.querySelectorAll(selector)); });
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document.createElement = tag => new Element(tag);
  document.body = new Element('body');
  document.querySelector = selector => selector === 'dialog[open]' ? null : document.body.querySelector(selector);
  const container = new Element('main'); document.body.append(container);
  const sandbox = vm.createContext({ window: {}, document, console });
  for (const file of ['js/core/random.js', 'js/core/ui.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  const M = sandbox.window.MindOrbit;
  M.catalog = Object.fromEntries(['A1', 'A2', 'A3', 'D1', 'D2', 'D3'].map(key => [key, { id: key }]));
  for (const file of ['js/games/memory.js', 'js/games/reaction.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
  const seed = options.seed || 'test-seed';
  const rng = M.random(seed);
  if (options.int) rng.int = options.int;
  const sessionDeadline = options.deadline || 120000;
  function timeout() {
    if (terminal) return;
    result = { outcome: 'timeout', metrics: plain(session.onTimeout()) };
    terminal = true;
  }
  const ctx = {
    container, rng, sessionDeadline,
    now: () => now, elapsed: () => now,
    schedule(fn, delay) { stats.scheduleCalls++; const id = ++nextId; queue.set(id, { at: now + Math.max(0, delay), fn }); return id; },
    cancel(id) { queue.delete(id); },
    frame(fn) { return ctx.schedule(fn, options.frameDelay === undefined ? 16 : options.frameDelay); },
    listen(target, type, fn) {
      if (!listeners.has(target)) listeners.set(target, new Map());
      const events = listeners.get(target);
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(event => {
        if (terminal || event.repeat) return;
        if (now >= sessionDeadline) { timeout(); return; }
        stats.inputEvents++;
        fn(event);
      });
    },
    finish(outcome, metrics) { stats.finishCalls++; if (!terminal) { terminal = true; result = { outcome, metrics: plain(metrics) }; } },
    abort(message) { stats.abortCalls++; terminal = true; abortMessage = message; },
    setStatus() {}, setProgress() {},
    setStage(value) { stage = value; }, setRemaining(value) { remaining = value; }
  };
  session = M.games[id].createSession(ctx);
  function advance(to) {
    assert.ok(to >= now, `cannot reverse time (${now} -> ${to})`);
    while (true) {
      const entry = [...queue.entries()].filter(([, task]) => task.at <= to).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!entry) break;
      const [key, task] = entry;
      queue.delete(key);
      now = Math.max(now, task.at);
      if (!terminal && now >= sessionDeadline) timeout();
      if (!terminal) task.fn();
    }
    now = to;
    if (!terminal && now >= sessionDeadline) timeout();
  }
  function dispatch(target, type, properties = {}) {
    const event = { target, button: 0, pointerId: 1, detail: 1, repeat: false, preventDefault() { this.defaultPrevented = true; }, ...properties };
    let node = target;
    while (node) {
      for (const callback of listeners.get(node)?.get(type) || []) callback(event);
      node = node.parentNode;
    }
    if (target !== document) for (const callback of listeners.get(document)?.get(type) || []) callback(event);
    return event;
  }
  const h = {
    M, seed, document, container, session, stats,
    get now() { return now; }, get stage() { return stage; }, get remaining() { return remaining; },
    get result() { return result; }, get abortMessage() { return abortMessage; },
    start() { session.start(); }, advance,
    jump(to) { assert.ok(to >= now); now = to; },
    next() { const at = Math.min(...[...queue.values()].map(task => task.at)); assert.ok(Number.isFinite(at), 'expected pending task'); advance(Math.max(now, at)); },
    dispatch,
    press(node) { assert.ok(node, 'button exists'); dispatch(node, 'pointerdown'); dispatch(document, 'pointerup'); dispatch(node, 'click', { detail: 1 }); },
    key(key, repeat = false) { dispatch(document, 'keydown', { key, repeat, target: document.activeElement || document.body }); },
    release(key) { dispatch(document, 'keyup', { key, target: document.activeElement || document.body }); },
    cells() { return container.querySelectorAll('.grid-cell'); },
    button(text) { return container.querySelectorAll('button').find(button => button.textContent === text); },
    signal() { let steps = 0; while (stage !== 'answering') { assert.ok(++steps < 100); h.next(); } return now; }
  };
  if (options.start !== false) h.start();
  return h;
}

function litCells(h) { return h.cells().flatMap((button, index) => button.classList.contains('lit') ? [index] : []); }
function answerMatrix(h, targets) { targets.forEach(index => h.press(h.cells()[index])); h.press(h.button('确认')); }
function readDigits(h, length) {
  const sequence = [];
  for (let index = 0; index < length; index++) {
    sequence.push(h.container.querySelector('.digit-display').textContent);
    h.advance(h.now + 800);
  }
  return sequence.join('');
}
function completeDigits(h, sequence) { [...sequence].forEach(digit => h.key(digit)); h.key('Enter'); }

test('registers exactly the six games and generators reproduce constrained stimuli', () => {
  const h = harness('A1', { start: false });
  assert.deepEqual(Object.keys(h.M.games), ['A1', 'A2', 'A3', 'D1', 'D2', 'D3']);
  for (let seed = 0; seed < 150; seed++) {
    const g = h.M.generators, rng = h.M.random(seed);
    const questions = plain(g.stroop(rng));
    assert.deepEqual(questions, plain(g.stroop(h.M.random(seed))));
    assert.equal(questions.length, 12);
    assert.equal(questions.filter(q => q.record.congruent).length, 4);
    assert.equal(new Set(questions.map(q => q.record.word + q.record.ink)).size, 12);
    for (const ink of ['红', '蓝', '绿', '黄']) assert.equal(questions.filter(q => q.record.ink === ink).length, 3);
    for (const q of questions) {
      assert.equal(q.options[q.answer], q.record.ink);
      assert.deepEqual(q.options, questions[0].options);
      assert.equal(new Set(q.options).size, 4);
      assert.equal(q.record.congruent, q.record.word === q.record.ink);
      assert.ok(['#fb7185', '#60a5fa', '#4ade80', '#facc15'].includes(q.record.inkColor));
    }
    const positions = plain(g.targets(rng));
    assert.equal(positions.length, 15);
    positions.forEach((position, i) => { assert.ok(position >= 0 && position < 9); assert.notEqual(position, positions[i - 1]); });
    const layout = plain(g.memoryPairs(rng));
    assert.equal(layout.length, 16);
    assert.equal(new Set(layout).size, 8);
    layout.forEach(symbol => assert.equal(layout.filter(item => item === symbol).length, 2));
    for (let count = 3; count <= 8; count++) {
      const pattern = plain(g.matrix(rng, count));
      assert.equal(pattern.length, count); assert.equal(new Set(pattern).size, count);
      pattern.forEach(cell => assert.ok(cell >= 0 && cell < 16));
    }
  }
  const predictable = { sample: (values, count) => values.slice(0, count), pick: values => values[0], int: min => min };
  assert.notDeepEqual(plain(h.M.generators.matrix(predictable, 3, [0, 1, 2])), [0, 1, 2]);
  assert.equal(h.M.generators.digits(predictable, 3), '000');
  assert.equal(h.M.generators.digits(predictable, 3, '000'), '001');
});

test('A1: presentation, masking, toggles, selection cap and all six levels', () => {
  const h = harness('A1');
  for (let count = 3; count <= 8; count++) {
    const targets = litCells(h), began = h.now;
    assert.equal(targets.length, count);
    h.press(h.cells()[targets[0]]);
    assert.equal(h.cells().filter(button => button.classList.contains('selected')).length, 0);
    h.advance(began + 1199); assert.equal(litCells(h).length, count);
    h.advance(began + 1200); assert.equal(litCells(h).length, 0);
    assert.ok(h.cells().every(button => !button.textContent && !button.getAttribute('aria-label').includes('亮格')));
    h.advance(began + 1499); assert.ok(h.cells().every(button => button.disabled));
    h.advance(began + 1500); assert.equal(h.stage, 'answering');
    h.press(h.cells()[targets[0]]); h.press(h.cells()[targets[0]]);
    assert.ok(h.button('确认').disabled);
    targets.forEach(index => h.press(h.cells()[index]));
    const extra = h.cells().find((button, i) => !targets.includes(i)); h.press(extra);
    assert.equal(h.cells().filter(button => button.classList.contains('selected')).length, count);
    h.press(h.button('确认')); h.press(h.button('确认'));
    h.advance(h.now + 500);
  }
  assert.equal(h.stats.finishCalls, 1);
  assert.equal(h.result.metrics.maxCorrectCells, 8);
  assert.equal(h.result.metrics.correctRounds, 6);
  assert.equal(h.result.metrics.errors, 0);
  assert.equal(h.result.metrics.livesRemaining, 3);
  assert.deepEqual(h.result.metrics.trials.map(t => t.count), [3, 4, 5, 6, 7, 8]);
});

test('A1: same-level retry, wrong group, three lives and exclusive deadline', () => {
  const h = harness('A1');
  const first = litCells(h);
  h.advance(1500); answerMatrix(h, first); h.advance(2000);
  const second = litCells(h); assert.equal(second.length, 4);
  h.advance(3500);
  const wrong = second.slice(); wrong[0] = Array.from({ length: 16 }, (_, i) => i).find(i => !second.includes(i));
  answerMatrix(h, wrong); h.advance(4000);
  const retry = litCells(h); assert.equal(retry.length, 4); assert.notDeepEqual(retry, second);
  h.advance(5500);
  retry.forEach(index => h.press(h.cells()[index]));
  h.jump(13500); h.press(h.button('确认'));
  assert.equal(h.stage, 'answering'); // Boundary input does not submit a correct answer.
  h.advance(13500); assert.equal(h.stage, 'feedback');
  h.advance(14000); h.advance(15500);
  h.press(h.cells()[0]); h.press(h.button('确认')); // Too few cells cannot submit.
  assert.equal(h.stage, 'answering');
  h.advance(24000);
  assert.equal(h.result.metrics.maxCorrectCells, 3);
  assert.equal(h.result.metrics.correctRounds, 1);
  assert.equal(h.result.metrics.errors, 3);
  assert.equal(h.result.metrics.livesRemaining, 0);
  assert.deepEqual(h.result.metrics.trials.map(t => t.count), [3, 4, 4, 4]);
  assert.equal(h.stats.finishCalls, 1);
});

test('A2: leading zero, repeated digit, blank intervals, ignored playback and key repeat', () => {
  const values = [0, 0, 7];
  const h = harness('A2', { int: () => values.length ? values.shift() : 5 });
  const display = h.container.querySelector('.digit-display');
  assert.equal(display.textContent, '0'); h.key('9'); h.press(h.button('9'));
  h.advance(600); assert.equal(display.textContent, '');
  assert.ok(!h.container.textContent.includes('007'));
  h.advance(800); assert.equal(display.textContent, '0');
  h.advance(1400); assert.equal(display.textContent, '');
  h.advance(1600); assert.equal(display.textContent, '7');
  h.advance(2200); assert.equal(display.textContent, '');
  h.advance(2400); assert.equal(display.textContent, '＿＿＿');
  h.key('0'); h.key('9', true); h.key('1'); h.key('Backspace'); h.key('0');
  assert.ok(h.button('确认').disabled);
  h.key('7'); h.key('8'); assert.equal(display.textContent, '007');
  h.key('Enter'); h.key('Enter'); h.advance(2900);
  assert.equal(h.stage, 'presenting'); assert.equal(display.textContent, '5');
  h.advance(6100); h.jump(12100); completeDigits(h, '5555'); h.advance(12100);
  assert.equal(h.stage, 'feedback');
  h.advance(12600); h.advance(22300);
  assert.equal(h.result.metrics.maxLength, 3);
  assert.equal(h.result.metrics.errors, 2);
  assert.equal(h.result.metrics.trials[0].sequence, '007');
  assert.equal(h.result.metrics.trials[0].answer, '007');
  assert.deepEqual(h.result.metrics.trials.map(t => t.length), [3, 4, 4]);
  assert.equal(h.stats.finishCalls, 1);
});

test('A2: completes every length through nine without replay or numeric coercion', () => {
  const h = harness('A2');
  for (let length = 3; length <= 9; length++) {
    const sequence = readDigits(h, length);
    assert.equal(sequence.length, length);
    completeDigits(h, sequence);
    h.advance(h.now + 500);
  }
  assert.equal(h.result.metrics.maxLength, 9);
  assert.equal(h.result.metrics.errors, 0);
  assert.equal(h.result.metrics.trials.length, 7);
});

test('A2: two wrong answers stop the game and a retry has a fresh sequence', () => {
  const h = harness('A2');
  const first = readDigits(h, 3);
  completeDigits(h, first === '000' ? '111' : '000'); h.advance(h.now + 500);
  const second = readDigits(h, 3); assert.notEqual(second, first);
  completeDigits(h, second === '000' ? '111' : '000'); h.advance(h.now + 500);
  assert.equal(h.result.metrics.errors, 2); assert.equal(h.result.metrics.maxLength, 0);
  assert.deepEqual(h.result.metrics.trials.map(t => t.outcome), ['incorrect', 'incorrect']);
});

test('A3: exact pairs, same-card guard, 700 ms mismatch lock and immediate completion', () => {
  const h = harness('A3');
  const layout = plain(h.M.generators.memoryPairs(h.M.random(h.seed)));
  const other = layout.findIndex(symbol => symbol !== layout[0]);
  h.press(h.cells()[0]); h.press(h.cells()[0]);
  assert.equal(h.cells().filter(button => button.classList.contains('selected')).length, 1);
  h.press(h.cells()[other]);
  const third = layout.findIndex((symbol, index) => index !== 0 && index !== other);
  h.press(h.cells()[third]); assert.equal(h.cells()[third].textContent, '◇');
  h.advance(699); assert.equal(h.cells()[0].textContent, layout[0]);
  h.advance(700); assert.equal(h.cells()[0].textContent, '◇'); assert.equal(h.cells()[other].textContent, '◇');
  for (const symbol of new Set(layout)) {
    const pair = layout.flatMap((item, index) => item === symbol ? [index] : []);
    h.press(h.cells()[pair[0]]); h.press(h.cells()[pair[1]]);
    h.press(h.cells()[pair[0]]);
  }
  assert.equal(h.result.metrics.matchedPairs, 8);
  assert.equal(h.result.metrics.moves, 9);
  assert.equal(h.result.metrics.durationMs, 700);
  assert.equal(h.stats.finishCalls, 1);
});

test('A3: partial progress survives timeout and one unpaired flip adds no move', () => {
  const h = harness('A3');
  const layout = plain(h.M.generators.memoryPairs(h.M.random(h.seed)));
  for (const symbol of [...new Set(layout)].slice(0, 4)) layout.forEach((item, i) => { if (item === symbol) h.press(h.cells()[i]); });
  h.press(h.cells().find(button => !button.disabled));
  h.advance(120000);
  assert.equal(h.result.metrics.matchedPairs, 4); assert.equal(h.result.metrics.moves, 4);
  assert.equal(h.result.metrics.durationMs, 120000); assert.equal(h.stats.finishCalls, 0);
});

test('D1: timestamp and signal appear in a frame; five valid samples retain slow values', () => {
  const h = harness('D1', { int: () => 2000 });
  h.advance(2000); assert.equal(h.stage, 'waiting');
  h.advance(2015); assert.equal(h.stage, 'waiting');
  const times = [100, 200, 350, 500, 1499];
  for (const rt of times) {
    const onset = h.signal();
    assert.equal(h.button('现在点击').classList.contains('lit'), true);
    h.advance(onset + rt); h.press(h.button('现在点击'));
    h.advance(h.now + 500);
  }
  assert.deepEqual(h.result.metrics.reactionTimes, times);
  assert.equal(h.result.metrics.meanRtMs, 529.8);
  assert.equal(h.result.metrics.medianRtMs, 350);
  assert.equal(h.result.metrics.penalties, 0); assert.equal(h.result.metrics.attempts, 5);
  assert.ok(h.result.metrics.trials.every(trial => trial.signalDelayMs === 2016));
  assert.equal(h.stats.finishCalls, 1);
});

test('D1: false starts, early responses, exact 1500 ms and stale signals are guarded', () => {
  const h = harness('D1', { int: () => 2000 });
  h.advance(2000); h.press(h.button('等待信号，不要点击')); // A signal frame is queued but not visible.
  h.advance(2016); assert.equal(h.stage, 'feedback');
  h.advance(2500); assert.equal(h.stage, 'waiting');
  let onset = h.signal(); h.advance(onset + 99); h.press(h.button('现在点击')); h.advance(h.now + 500);
  onset = h.signal(); h.jump(onset + 1500); h.press(h.button('现在点击')); h.advance(h.now);
  h.advance(h.now + 500);
  for (let attempt = 4; attempt <= 10; attempt++) { h.press(h.button('等待信号，不要点击')); h.advance(h.now + 500); }
  assert.equal(h.result.metrics.attempts, 10); assert.equal(h.result.metrics.penalties, 10);
  assert.equal(h.result.metrics.meanRtMs, null); assert.equal(h.result.metrics.medianRtMs, null);
  assert.deepEqual(h.result.metrics.trials.slice(0, 3).map(t => t.outcome), ['false-start', 'early', 'missed']);
  assert.equal(h.stats.finishCalls, 1);
});

test('D1: held space and pointer must release before another attempt can respond', () => {
  const h = harness('D1', { int: () => 2000 });
  h.key(' ');
  assert.equal(h.button('本次已结束').disabled, false);
  assert.equal(h.button('本次已结束').getAttribute('aria-disabled'), 'true');
  h.advance(500);
  let onset = h.signal(); h.advance(onset + 100);
  h.key(' ', true); h.key(' '); assert.equal(h.stage, 'answering');
  h.release(' '); h.key(' '); h.release(' '); assert.equal(h.stage, 'feedback');
  h.advance(h.now + 500);
  h.dispatch(h.button('等待信号，不要点击'), 'pointerdown'); h.advance(h.now + 500);
  onset = h.signal(); h.advance(onset + 100);
  h.dispatch(h.button('现在点击'), 'pointerdown'); assert.equal(h.stage, 'answering');
  h.dispatch(h.document, 'pointerup'); h.press(h.button('现在点击'));
  const metrics = plain(h.session.onTimeout());
  assert.equal(metrics.penalties, 2); assert.deepEqual(metrics.reactionTimes, [100, 100]);
});

test('D1: total cap counts the unfinished waiting attempt once, not feedback twice', () => {
  const h = harness('D1', { deadline: 1000 });
  h.advance(1000);
  assert.equal(h.result.metrics.penalties, 1); assert.equal(h.result.metrics.attempts, 1);
  assert.equal(h.result.metrics.trials[0].outcome, 'missed');
  assert.equal(h.stats.finishCalls, 0);
  assert.deepEqual(plain(h.session.onTimeout()), h.result.metrics);
  const feedback = harness('D1', { deadline: 100 });
  feedback.press(feedback.button('等待信号，不要点击')); feedback.advance(100);
  assert.equal(feedback.result.metrics.penalties, 1);
  assert.equal(feedback.result.metrics.trials.length, 1);
});

test('D2: fixed colored buttons, ink-based answers and shared quiz metrics', () => {
  const h = harness('D2');
  const questions = plain(h.M.generators.stroop(h.M.random(h.seed)));
  const inkColors = { 红: '#fb7185', 蓝: '#60a5fa', 绿: '#4ade80', 黄: '#facc15' };
  let fixed = null;
  questions.forEach(q => {
    const buttons = h.container.querySelectorAll('.answer-button');
    const labels = buttons.map(button => button.children[1].textContent);
    if (fixed === null) fixed = labels; else assert.deepEqual(labels, fixed);
    buttons.forEach(button => assert.equal(button.children[1].style.color, inkColors[button.children[1].textContent]));
    const word = h.container.querySelector('.stroop-word');
    assert.equal(word.textContent, q.record.word); assert.equal(word.style.color, q.record.inkColor);
    assert.equal(word.getAttribute('aria-label'), null);
    h.advance(h.now + 120); h.key(String(q.answer + 1)); h.key(String(q.answer + 1));
    h.advance(h.now + 500);
  });
  assert.equal(h.result.metrics.correct, 12); assert.equal(h.result.metrics.missed, 0);
  assert.equal(h.result.metrics.meanCorrectMs, 120); assert.equal(h.result.metrics.trials.length, 12);
  assert.equal(h.stats.finishCalls, 1);
});

test('D2: deadline answers are missed and unanswered questions keep the fixed denominator', () => {
  const h = harness('D2');
  h.jump(3000); h.key('1'); h.advance(3000);
  assert.equal(h.stage, 'feedback');
  h.advance(42000);
  assert.equal(h.result.metrics.correct, 0); assert.equal(h.result.metrics.missed, 12);
  assert.equal(h.result.metrics.meanCorrectMs, null);
  assert.ok(h.result.metrics.trials.every(t => t.answer === null && t.rtMs === 3000));
  const capped = harness('D2', { deadline: 1000 }); capped.advance(1000);
  assert.equal(capped.result.metrics.missed, 12); assert.equal(capped.result.metrics.correct, 0);
});

test('D3: fixed 30-second slots, one hit per target, blank guards and per-window misses', () => {
  const h = harness('D3');
  for (let slot = 0; slot < 15; slot++) {
    h.advance(slot * 2000 + 16);
    const [position] = litCells(h); assert.equal(litCells(h).length, 1);
    if (slot === 0) {
      h.press(h.cells()[(position + 1) % 9]);
      assert.equal(litCells(h).length, 1);
    }
    if (slot % 2 === 0) {
      h.advance(slot * 2000 + 116); h.press(h.cells()[position]);
      assert.equal(litCells(h).length, 0);
      h.press(h.cells()[position]); h.press(h.cells()[(position + 1) % 9]);
    }
    h.advance(slot * 2000 + 1500);
    assert.equal(litCells(h).length, 0);
    h.press(h.cells()[position]); h.press(h.cells()[(position + 1) % 9]);
    h.advance((slot + 1) * 2000);
    if (slot < 14) assert.equal(litCells(h).length, 0); // Next frame is not a premature next target.
  }
  assert.equal(h.now, 30000); assert.equal(h.stats.finishCalls, 1);
  const m = h.result.metrics;
  assert.equal(m.hits, 8); assert.equal(m.misses, 7); assert.equal(m.errors, 1); assert.equal(m.meanHitMs, 100);
  assert.equal(m.trials.length, 15);
  m.trials.forEach((trial, index) => { assert.equal(trial.scheduledMs, index * 2000); assert.equal(trial.shownMs, index * 2000 + 16); });
});

test('D3: exclusive active deadline, 250 ms tolerance and late frame abort', () => {
  const h = harness('D3'); h.advance(16); const [position] = litCells(h);
  h.jump(1500); h.press(h.cells()[position]); h.advance(1500);
  h.advance(30000); assert.equal(h.result.metrics.hits, 0); assert.equal(h.result.metrics.misses, 15);
  assert.equal(h.result.metrics.errors, 0); assert.equal(h.result.metrics.meanHitMs, null);
  const tolerated = harness('D3', { frameDelay: 250 }); tolerated.advance(250);
  assert.equal(litCells(tolerated).length, 1); assert.equal(tolerated.abortMessage, null);
  const late = harness('D3', { frameDelay: 251 }); late.advance(251); late.advance(30000);
  assert.match(late.abortMessage, /250 ms/); assert.equal(late.stats.abortCalls, 1); assert.equal(late.stats.finishCalls, 0);
  const delayed = harness('D3'); delayed.advance(1500); delayed.jump(2260); delayed.advance(2276);
  assert.match(delayed.abortMessage, /250 ms/); assert.equal(delayed.stats.finishCalls, 0);
});

test('D3: a stalled final stimulus timer aborts before the completion timer', () => {
  const h = harness('D3');
  h.advance(27500);
  h.jump(31000); h.advance(31000);
  assert.match(h.abortMessage, /250 ms/);
  assert.equal(h.stats.abortCalls, 1);
  assert.equal(h.stats.finishCalls, 0);
  assert.equal(h.result, null);
});

test('all six onTimeout methods only return metrics, remain finite and stop later callbacks', () => {
  for (const id of ['A1', 'A2', 'A3', 'D1', 'D2', 'D3']) {
    const h = harness(id);
    const before = { ...h.stats }, text = h.container.textContent;
    const metrics = plain(h.session.onTimeout());
    assert.ok(metrics && typeof metrics === 'object');
    assert.equal(h.stats.scheduleCalls, before.scheduleCalls); assert.equal(h.stats.finishCalls, 0);
    assert.equal(h.container.textContent, text);
    assert.deepEqual(plain(h.session.onTimeout()), metrics);
    h.advance(100000);
    assert.equal(h.container.textContent, text); assert.equal(h.stats.finishCalls, 0);
    function finite(value) { if (typeof value === 'number') assert.ok(Number.isFinite(value)); else if (value && typeof value === 'object') Object.values(value).forEach(finite); }
    finite(metrics);
  }
});

test('all six destroy methods are idempotent and prevent stale input or work', () => {
  for (const id of ['A1', 'A2', 'A3', 'D1', 'D2', 'D3']) {
    const h = harness(id);
    if (id === 'D1') h.advance(4000); // Includes a possibly queued signal frame.
    if (id === 'D2') h.key('1'); // A next-question feedback callback is pending.
    if (id === 'A3') {
      const layout = plain(h.M.generators.memoryPairs(h.M.random(h.seed)));
      h.press(h.cells()[0]); h.press(h.cells()[layout.findIndex(symbol => symbol !== layout[0])]);
    }
    const text = h.container.textContent, schedules = h.stats.scheduleCalls;
    h.session.destroy(); h.session.destroy();
    h.key('1'); h.key('Enter'); h.key(' ');
    h.container.querySelectorAll('button').forEach(button => h.press(button));
    h.advance(100000);
    assert.equal(h.container.textContent, text, id);
    assert.equal(h.stats.scheduleCalls, schedules, id);
    assert.equal(h.stats.finishCalls, 0, id); assert.equal(h.stats.abortCalls, 0, id);
  }
});
