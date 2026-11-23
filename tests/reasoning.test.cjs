'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..');
const IDS = ['B1','B2','B3','C1','C2','C3'];
const json = value => JSON.parse(JSON.stringify(value));

// Minimal DOM adapter runs the ACTUAL ui.quiz and game renderers. It is not a
// browser layout/assistive-technology test or a claim of human visual review.
class Node {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentNode = null; this.attributes = {}; this.style = { setProperty(key, value) { this[key] = String(value); } }; this.dataset = {}; this.listeners = new Map(); this.className = ''; this.disabled = false; this.text = ''; }
  setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children.forEach(node => node.parentNode = null); this.children = []; this.text = ''; this.append(...nodes); }
  set textContent(value) { this.replaceChildren(); this.text = String(value); }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(''); }
  get isConnected() { return this === this.document.body || Boolean(this.parentNode?.isConnected); }
  focus() { this.document.activeElement = this; }
  querySelectorAll(selector) { const result = []; const walk = node => { for (const child of node.children) { if (selector[0] === '.' ? child.className.split(' ').includes(selector.slice(1)) : child.tagName === selector.toUpperCase()) result.push(child); walk(child); } }; walk(this); return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  dispatch(type, data = {}) { const event = { button: 0, detail: 0, target: this, preventDefault() {}, ...data }; for (const fn of [...(this.listeners.get(type) || [])]) fn(event); }
}
function load() {
  const document = { listeners: new Map(), querySelector: () => null };
  document.createElement = tag => new Node(tag, document);
  document.createElementNS = (_, tag) => new Node(tag, document);
  document.body = new Node('body', document);
  document.dispatch = Node.prototype.dispatch;
  const context = vm.createContext({ window: {}, document, console });
  const run = file => vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
  run('js/core/random.js');
  const M = context.window.MindOrbit;
  M.catalog = Object.fromEntries(IDS.map(id => [id, { name: id }]));
  M.data.unrelated = { retained: true }; M.generators = { unrelated: 'retained' };
  for (const file of ['js/core/ui.js','js/data/questions.js','js/data/stimuli.js','js/games/imagination.js','js/games/logic.js']) run(file);
  return { M, document };
}
const { M } = load();
const counts = values => values.reduce((result, value) => { result[value] = (result[value] || 0)+1; return result; }, {});
function questionContract(id, questions) {
  assert.equal(questions.length, id === 'B1' ? 10 : 8);
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
  for (const q of questions) {
    assert.equal(q.options.length, id === 'B1' ? 2 : id === 'C3' ? 3 : 4);
    assert.equal(new Set(q.options.map(option => JSON.stringify(option))).size, q.options.length);
    assert(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length);
    assert(q.explanation.length > 5); assert(q.prompt.length > 5); assert(q.record);
    assert.equal(q.limitMs, { B1: 6000, B2: 8000, B3: 10000, C1: 12000, C2: 12000, C3: 12000 }[id]);
    assert.equal(JSON.stringify(json(q)), JSON.stringify(q));
  }
}

// Independent coordinate validator (does not use the implementation's keys).
function canonical(cells) {
  const x = Math.min(...cells.map(p => p[0])), y = Math.min(...cells.map(p => p[1]));
  return cells.map(p => [p[0]-x,p[1]-y].join(',')).sort().join(';');
}
function rotations(cells) {
  let points = json(cells); const keys = [];
  for (let i = 0; i < 4; i++) { keys.push(canonical(points)); points = points.map(([x,y]) => [y,-x]); }
  return keys;
}
function independentTerms(type, p) {
  if (type === 'arithmetic') return Array.from({ length: 6 }, (_, i) => p.start+i*p.difference);
  if (type === 'geometric') return Array.from({ length: 6 }, (_, i) => p.start*p.ratio**i);
  if (type === 'growing') return Array.from({ length: 6 }, (_, i) => p.start+i*p.firstDifference+(i*(i-1)/2)*p.increment);
  return Array.from({ length: 7 }, (_, i) => p.start+Math.ceil(i/2)*p.p+Math.floor(i/2)*p.q);
}
function checkC1(q) {
  const r = q.record, p = r.parameters, expected = independentTerms(r.template, p);
  assert.deepEqual(json(r.sequence), expected.slice(0,-1)); assert.equal(q.options[q.answer], expected.at(-1));
  assert(q.options.every(n => Number.isInteger(n) && n >= 0 && n <= 2000));
}
function nextState(state, changing) {
  return { direction: changing.includes('direction') ? (state.direction+1)%4 : state.direction, count: changing.includes('count') ? state.count%3+1 : state.count, filled: changing.includes('filled') ? !state.filled : state.filled };
}
function checkC2(q) {
  let state = json(q.record.initial);
  for (const displayed of q.record.sequence) { assert.deepEqual(json(displayed), state); state = nextState(state, q.record.changing); }
  assert.deepEqual(json(q.options[q.answer]), state);
  assert.deepEqual(json(q.record.periods), { direction: 4, count: 3, filled: 2 });
  assert.deepEqual(json(q.record.options), json(q.options));
}

// Independently integrate path length and point-to-segment distances. Checking
// only distinct IDs/path strings would NOT establish visible match uniqueness.
function sampledVisible(record, outlines) {
  const points = outlines.find(o => o.id === record.baseId).points;
  const segments = points.map((a, i) => { const b = points[(i+1)%points.length]; return { a, b, length: Math.hypot(b[0]-a[0], b[1]-a[1]) }; });
  const length = segments.reduce((sum, segment) => sum+segment.length, 0), visible = [];
  for (let index = 0; index < 1600; index++) {
    const fraction = (index+0.5)/1600, phase = (fraction*100+record.offset)%100;
    let cursor = 0, on = false;
    for (let i = 0; i < record.dash.length; i++) { if (phase >= cursor && phase < cursor+record.dash[i]) on = i%2 === 0; cursor += record.dash[i]; }
    if (!on) continue;
    let distance = fraction*length;
    for (const segment of segments) {
      if (distance < segment.length) { const t = distance/segment.length; visible.push([segment.a[0]+(segment.b[0]-segment.a[0])*t, segment.a[1]+(segment.b[1]-segment.a[1])*t]); break; }
      distance -= segment.length;
    }
  }
  return visible;
}
function contourDistance(point, outline) {
  let distance = Infinity;
  outline.points.forEach((a, i) => {
    const b = outline.points[(i+1)%outline.points.length], dx = b[0]-a[0], dy = b[1]-a[1];
    const t = Math.min(1, Math.max(0, ((point[0]-a[0])*dx+(point[1]-a[1])*dy)/(dx*dx+dy*dy)));
    distance = Math.min(distance, Math.hypot(point[0]-a[0]-t*dx, point[1]-a[1]-t*dy));
  });
  return distance;
}

// Transform the ACTUAL rendered path, not merely the option's abstract state.
function renderedPatternSignature(svg) {
  return svg.querySelectorAll('path').map(node => {
    const values = node.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
    const [tx,ty,degrees] = node.getAttribute('transform').match(/-?\d+(?:\.\d+)?/g).map(Number), angle = degrees*Math.PI/180;
    const points = [];
    for (let i = 0; i < values.length; i += 2) points.push([tx+values[i]*Math.cos(angle)-values[i+1]*Math.sin(angle),ty+values[i]*Math.sin(angle)+values[i+1]*Math.cos(angle)].map(n => Math.round(n*1000)/1000).join(','));
    return node.getAttribute('fill') + '|' + points.sort().join(';');
  }).sort().join('/');
}

test('classic scripts register six games and preserve other agents’ subkeys', () => {
  assert.deepEqual(Object.keys(M.games).sort(), IDS);
  assert.equal(M.generators.unrelated, 'retained'); assert.equal(M.data.unrelated.retained, true);
  for (const id of IDS) assert.equal(typeof M.games[id].createSession, 'function');
  for (const file of ['js/data/questions.js','js/data/stimuli.js','js/games/imagination.js','js/games/logic.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert(!/\b(?:setTimeout|setInterval|requestAnimationFrame|fetch|localStorage|XMLHttpRequest|innerHTML)\b/.test(source), file);
    assert(!/\.addEventListener\s*\(|\bonclick\s*=|\bimport\s|\brequire\s*\(/.test(source), file);
  }
});

test('B1 all 15 bases are connected, asymmetric, 5–7 cells and distinct rotation classes', () => {
  const classes = new Set();
  assert(M.data.B1.length >= 10);
  for (const shape of M.data.B1) {
    assert(shape.cells.length >= 5 && shape.cells.length <= 7);
    const occupied = new Set(shape.cells.map(p => p.join(','))), seen = new Set(), stack = [shape.cells[0]];
    while (stack.length) { const [x,y] = stack.pop(), key = x+','+y; if (!occupied.has(key) || seen.has(key)) continue; seen.add(key); stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]); }
    assert.equal(seen.size, shape.cells.length);
    const orbit = rotations(shape.cells); assert.equal(new Set(orbit).size, 4);
    assert(!orbit.includes(canonical(shape.cells.map(([x,y]) => [-x,y]))));
    const key = orbit.sort()[0]; assert(!classes.has(key)); classes.add(key);
    assert(M.generators.B1.validateShape(shape.cells));
    const svg = M.generators.B1.renderCells(shape.cells);
    assert.equal(svg.querySelectorAll('rect').length, shape.cells.length);
    assert(svg.querySelectorAll('rect').every(node => node.getAttribute('width') === '16' && node.getAttribute('height') === '16'));
  }
  for (const invalid of [[], [[0,0],[1,0],[0,1],[1,1]], [[0,0],[1,0],[2,0],[3,0],[4,0]], [[0,0],[0,0],[1,0],[1,1],[2,1]], [[0,0],[1,0],[8,8],[9,8],[9,9]]]) assert.equal(M.generators.B1.validateShape(invalid), false);
});

test('B2 all 36 fixed masks: contour-length ratios, visible uniqueness, SVG parity', () => {
  const { outlines, records } = M.data.B2;
  assert.equal(outlines.length, 12); assert.equal(records.length, 36);
  assert.equal(new Set(outlines.map(o => JSON.stringify(o.points))).size, 12);
  let minimumMismatch = 1;
  for (const outline of outlines) assert.deepEqual(counts(records.filter(r => r.baseId === outline.id).map(r => r.level)), { low: 1, mid: 1, high: 1 });
  for (const record of records) {
    assert(M.generators.B2.validateMask(record));
    const hidden = record.dash.filter((_, i) => i%2).reduce((a,b) => a+b, 0);
    assert.equal(hidden, record.hiddenPercent); assert.equal(record.dash.reduce((a,b) => a+b), 100);
    const bounds = { low: [20,30], mid: [30,40], high: [40,50] }[record.level]; assert(hidden >= bounds[0] && hidden <= bounds[1]);
    const visible = sampledVisible(record, outlines); assert(Math.abs(visible.length/1600-(1-hidden/100)) < 0.002);
    let matches = 0;
    for (const id of record.options) {
      const outline = outlines.find(o => o.id === id), distances = visible.map(p => contourDistance(p, outline));
      const mismatch = distances.filter(d => d > 3).length/distances.length;
      if (id === record.baseId) { assert(Math.max(...distances) < 1e-8); matches++; }
      else { minimumMismatch = Math.min(minimumMismatch, mismatch); assert(mismatch > 0.25, record.id + ' vs ' + id); }
    }
    assert.equal(matches, 1);
    const masked = M.generators.B2.renderOutline(record.baseId, record).querySelector('path');
    const full = M.generators.B2.renderOutline(record.baseId).querySelector('path');
    assert.equal(masked.getAttribute('d'), full.getAttribute('d')); assert.equal(masked.getAttribute('pathLength'), '100');
    assert.equal(masked.getAttribute('stroke-dasharray'), record.dash.join(' ')); assert.equal(masked.getAttribute('stroke-dashoffset'), String(record.offset));
    assert.equal(masked.getAttribute('stroke-width'), '3'); assert.equal(full.getAttribute('stroke-width'), '3'); assert.equal(full.getAttribute('stroke-dasharray'), null);
  }
  assert(minimumMismatch > 0.30); // Empirical geometric separation, NOT a user study.
});

test('B3 40 authored records: relation direction, explicit semantic exclusions and quotas', () => {
  assert.equal(M.data.B3.length, 40);
  assert.deepEqual(counts(M.data.B3.map(q => q.type)), { category: 10, purpose: 10, wholePart: 10, correspondence: 10 });
  for (const item of M.data.B3) {
    assert.equal(new Set(item.options).size, 4); assert.equal(item.options[item.answer], item.solution);
    assert(item.explanation.includes(item.a)); assert(item.explanation.includes(item.c));
    assert(item.review.exclusions.length >= 10); assert(item.review.status.includes('pending'));
  }
  // Independently authored meaning assertions, not simply comparing answer IDs.
  const semanticAnchors = [
    ['鲤鱼','鱼类','动物所属类别'], ['千克','质量单位','计量单位类别'],
    ['天平','测质量','仪器与测量对象'], ['望远镜','观察远物','光学工具与用途'],
    ['拉链','链齿','物品整体与结构部分'], ['树','树枝','整体与自身部分'],
    ['袜子','脚','衣物与穿戴部位'], ['绿灯','通行','交通信号与基本指令'],
    ['东','西','基本方位的相反方向'], ['小猫','成年猫','动物幼年与成年']
  ];
  for (const [c, answer, relation] of semanticAnchors) { const item = M.data.B3.find(q => q.c === c); assert.equal(item.solution, answer); assert.equal(item.relation, relation); }
});

test('C1 exhaustive 1,440 legal parameter combinations match independent closed-form terms', () => {
  let total = 0;
  for (const [type, pool] of Object.entries(M.data.C1.parameterPools)) {
    assert.equal(new Set(pool.map(p => JSON.stringify(p))).size, pool.length);
    for (const p of pool) {
      total++;
      if (type === 'arithmetic') { assert(p.start >= 1 && p.start <= 20); assert(p.difference >= 2 && p.difference <= 9); }
      if (type === 'geometric') { assert(p.start >= 1 && p.start <= 5); assert([2,3].includes(p.ratio)); }
      if (type === 'growing') { assert(p.start >= 1 && p.start <= 10); assert(p.firstDifference >= 1 && p.firstDifference <= 5); assert(p.increment >= 1 && p.increment <= 3); }
      if (type === 'alternating') { assert(p.p >= 2 && p.p <= 9 && p.q >= 2 && p.q <= 9); assert.notEqual(p.p, p.q); }
      const terms = independentTerms(type, p); assert.deepEqual(json(M.generators.C1.terms(type, p)), terms);
      assert(terms.every(n => Number.isInteger(n) && n >= 0 && n <= 2000));
    }
  }
  assert.equal(total, 1440);
});

test('C2 all 24 actual rendered states are visually distinct and keep size/spacing/colour', () => {
  const signatures = new Set();
  for (let direction = 0; direction < 4; direction++) for (let count = 1; count <= 3; count++) for (const filled of [false,true]) {
    const svg = M.generators.C2.renderPattern({ direction, count, filled });
    assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.getAttribute('viewBox'), '0 0 128 64');
    assert.equal(svg.querySelectorAll('path').length, count);
    const signature = renderedPatternSignature(svg); assert(!signatures.has(signature)); signatures.add(signature);
    for (const node of svg.querySelectorAll('path')) {
      assert.equal(node.getAttribute('stroke-width'), '2'); assert.equal(node.getAttribute('stroke'), 'currentColor');
      assert.equal(node.getAttribute('fill'), filled ? 'currentColor' : 'none');
      const nums = node.getAttribute('transform').match(/-?\d+/g).map(Number); assert.equal(nums[2], direction*90);
    }
  }
  assert.equal(signatures.size, 24);
});

test('C3 all 36 fixed patterns independently enumerate exactly one model and true SPEAKER', () => {
  const patterns = new Set(); let targetIsNotSpeaker = 0;
  for (const item of M.data.C3) {
    const pattern = item.statements.map(s => s.op+':'+s.person).join('/'); assert(!patterns.has(pattern)); patterns.add(pattern);
    assert.equal(new Set(item.statements.map(s => s.op+s.person)).size, 3);
    const models = ['A','B','C'].map(target => ({ target, truth: item.statements.map(s => s.op === 'is' ? s.person === target : s.person !== target) }));
    const valid = models.filter(model => model.truth.filter(Boolean).length === 1); assert.equal(valid.length, 1);
    assert.equal(item.target, valid[0].target); assert.equal(item.truthSpeaker, ['A','B','C'][valid[0].truth.indexOf(true)]);
    assert(M.generators.C3.validateTruth(item)); if (item.target !== item.truthSpeaker) targetIsNotSpeaker++;
  }
  assert.equal(patterns.size, 36); assert(targetIsNotSpeaker >= 12);
  assert.equal(M.generators.C3.validateTruth({ statements: ['A','B','C'].map(person => ({ op: 'is', person })), target: 'A', truthSpeaker: 'A' }), false);
  assert.equal(M.generators.C3.validateTruth({ statements: ['A','B','C'].map(person => ({ op: 'isnot', person })), target: 'A', truthSpeaker: 'A' }), false);
  assert.throws(() => M.generators.C3.enumerate([{ op: 'maybe', person: 'A' },{ op: 'is', person: 'B' },{ op: 'is', person: 'C' }]));
});

test('seeds 0–255: all six games reproduce stimuli and satisfy every quota, bound and uniqueness rule', () => {
  const snapshots = JSON.stringify(M.data), answerPositions = Object.fromEntries(IDS.map(id => [id, new Set()]));
  for (let seed = 0; seed < 256; seed++) for (const id of IDS) {
    const questions = M.generators[id](M.random(seed)); questionContract(id, questions);
    assert.equal(JSON.stringify(questions), JSON.stringify(M.generators[id](M.random(seed))));
    questions.forEach(q => answerPositions[id].add(q.answer));
    if (id === 'B1') {
      assert.equal(questions.filter(q => q.record.mirrored).length, 5);
      assert.equal(new Set(questions.map(q => rotations(q.record.left).sort()[0])).size, 10);
      for (const q of questions) { const equivalent = rotations(q.record.left).includes(canonical(q.record.right)); assert.equal(q.options[q.answer], equivalent ? '相同' : '不同'); assert([1,2,3].includes(q.record.turns)); }
    }
    if (id === 'B2') { assert.deepEqual(json(questions.map(q => q.record.level)), ['low','low','low','mid','mid','mid','high','high']); assert.equal(new Set(questions.map(q => q.record.baseId)).size, 8); for (const q of questions) assert.equal(q.options[q.answer], q.record.baseId); }
    if (id === 'B3') { assert.deepEqual(counts(questions.map(q => q.record.type)), { category: 2, purpose: 2, wholePart: 2, correspondence: 2 }); for (const q of questions) assert.equal(q.options[q.answer], M.data.B3.find(item => item.id === q.id).solution); }
    if (id === 'C1') { assert.deepEqual(counts(questions.map(q => q.record.template)), { arithmetic: 2, geometric: 2, growing: 2, alternating: 2 }); questions.forEach(checkC1); }
    if (id === 'C2') { assert.deepEqual(json(questions.map(q => q.record.changing.length)), [1,1,1,1,2,2,2,2]); assert.equal(new Set(questions.map(q => JSON.stringify(q.record.sequence))).size, 8); for (const q of questions) { checkC2(q); assert.equal(new Set(q.options.map(option => renderedPatternSignature(M.generators.C2.renderPattern(option)))).size, 4); } }
    if (id === 'C3') for (const q of questions) { assert.equal(q.options[q.answer], q.record.truthSpeaker); for (const p of ['A','B','C']) assert(q.explanation.includes('若获奖者是 ' + p)); }
  }
  assert.equal(JSON.stringify(M.data), snapshots, 'generating/shuffling must not mutate shared pools');
  for (const id of IDS) assert.equal(answerPositions[id].size, id === 'B1' ? 2 : id === 'C3' ? 3 : 4);
});

function sessionHarness(id, seed = 'session', hardLimit = 120000) {
  const { M, document } = load(), container = document.createElement('div'); document.body.append(container);
  const questions = M.generators[id](M.random(seed));
  let time = 0, token = 0, ended = false, session;
  const timers = new Map(), listeners = [], results = [], stages = [];
  const dispose = () => { timers.clear(); listeners.splice(0).forEach(remove => remove()); session.destroy(); };
  const ctx = {
    container, rng: M.random(seed), now: () => time, elapsed: () => time, sessionDeadline: hardLimit,
    schedule(fn, delay) { const id = ++token; timers.set(id, { at: time+delay, fn }); return id; },
    cancel(id) { timers.delete(id); }, frame(fn) { return this.schedule(fn, 16); },
    listen(target, type, fn) { if (!target.listeners.has(type)) target.listeners.set(type, new Set()); target.listeners.get(type).add(fn); const remove = () => target.listeners.get(type).delete(fn); listeners.push(remove); return remove; },
    setStatus() {}, setProgress(current, total) { assert(current >= 1 && current <= total); }, setStage(stage) { stages.push(stage); }, setRemaining(deadline) { assert(deadline > time); },
    finish(outcome, metrics) { assert(!ended, 'one finish only'); ended = true; results.push({ outcome, metrics: json(metrics) }); dispose(); },
    abort(message) { throw new Error(message); }
  };
  session = M.games[id].createSession(ctx);
  function timeout() { if (ended) return; ended = true; const metrics = session.onTimeout(); results.push({ outcome: 'timeout', metrics: json(metrics) }); dispose(); }
  function advance(delta) {
    const end = time+delta;
    while (!ended) {
      const next = [...timers.entries()].sort((a,b) => a[1].at-b[1].at || a[0]-b[0])[0];
      if (hardLimit <= end && (!next || hardLimit <= next[1].at)) { time = hardLimit; timeout(); break; }
      if (!next || next[1].at > end) break;
      time = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    time = end;
  }
  const select = (index, mode = 'pointerdown') => { const node = container.querySelectorAll('button')[index]; if (node) node.dispatch(mode, { detail: mode === 'click' ? 0 : 1 }); };
  session.start();
  return { M, ctx, questions, container, document, results, stages, timers, listeners, session, advance, select, timeout, setTime(value) { time = value; }, abort() { ended = true; dispose(); } };
}

for (const id of IDS) {
  test(id + ' actual quiz: pointer/keyboard, correct metrics, locking and cleanup', () => {
    const h = sessionHarness(id);
    for (let index = 0; index < h.questions.length; index++) {
      const question = h.questions[index]; h.advance(100);
      // Key repeat never submits; click+pointer never double-submit.
      h.document.dispatch('keydown', { key: String(question.answer+1), repeat: true, target: h.container });
      assert.equal(h.stages.at(-1), 'answering');
      if (index%2) h.document.dispatch('keydown', { key: String(question.answer+1), repeat: false, target: h.container });
      else h.select(question.answer);
      h.select(question.answer, 'click'); h.select((question.answer+1)%question.options.length);
      assert.equal(h.stages.at(-1), 'feedback');
      if (id === 'B2') { const reveal = h.container.querySelector('.completion-reveal'); assert(reveal); assert.equal(reveal.querySelector('path').getAttribute('stroke-dasharray'), null); }
      h.advance(500);
    }
    assert.equal(h.results.length, 1); const result = h.results[0]; assert.equal(result.outcome, 'completed');
    assert.equal(result.metrics.correct, h.questions.length); assert.equal(result.metrics.missed, 0); assert.equal(result.metrics.meanCorrectMs, 100); assert.equal(result.metrics.trials.length, h.questions.length);
    assert(result.metrics.trials.every((trial, i) => trial.id === h.questions[i].id && trial.correct && JSON.stringify(trial.stimulus) === JSON.stringify(h.questions[i].record)));
    assert.equal(h.timers.size, 0); assert.equal(h.listeners.length, 0); h.advance(200000); assert.equal(h.results.length, 1);
    for (const svg of h.container.querySelectorAll('svg')) { assert.equal(svg.getAttribute('aria-hidden'), 'true'); assert.equal(svg.style.width, '100%'); }
  });
  test(id + ' all wrong/all unanswered/boundary timeout retain fixed denominator', () => {
    const wrong = sessionHarness(id);
    for (const question of wrong.questions) { wrong.advance(100); wrong.select((question.answer+1)%question.options.length); wrong.advance(500); }
    assert.equal(wrong.results[0].metrics.correct, 0); assert.equal(wrong.results[0].metrics.missed, 0); assert.equal(wrong.results[0].metrics.meanCorrectMs, null);
    const missing = sessionHarness(id); missing.advance(119999);
    assert.equal(missing.results.length, 1); assert.equal(missing.results[0].metrics.missed, missing.questions.length); assert.equal(missing.results[0].metrics.meanCorrectMs, null);
    assert(missing.results[0].metrics.trials.every(t => t.answer === null && !t.correct));
    const boundary = sessionHarness(id); boundary.setTime(boundary.questions[0].limitMs); boundary.select(boundary.questions[0].answer); boundary.timeout();
    assert.equal(boundary.results[0].metrics.correct, 0); assert.equal(boundary.results[0].metrics.missed, boundary.questions.length); assert.equal(boundary.results[0].metrics.trials[0].answer, null);
  });
  test(id + ' hard deadline and abort clean stale callbacks without finish from onTimeout', () => {
    const h = sessionHarness(id, 'hard', 750); h.advance(100); h.select(h.questions[0].answer); h.advance(1000);
    assert.equal(h.results.length, 1); assert.equal(h.results[0].outcome, 'timeout'); assert.equal(h.results[0].metrics.correct, 1); assert.equal(h.results[0].metrics.missed, h.questions.length-1);
    const a = sessionHarness(id); a.advance(100); a.select(a.questions[0].answer); a.abort(); a.session.destroy(); a.advance(200000); assert.equal(a.results.length, 0); assert.equal(a.timers.size, 0); assert.equal(a.listeners.length, 0);
    const zero = sessionHarness(id); zero.timeout(); assert.equal(zero.results[0].metrics.missed, zero.questions.length); assert.equal(zero.results[0].metrics.meanCorrectMs, null);
  });
}

test('insufficient/corrupt independent pools refuse to start rather than repeating questions', () => {
  for (const [id, corrupt] of [
    ['B1', M => { M.data.B1 = M.data.B1.slice(0,9); }],
    ['B2', M => { M.data.B2.records = M.data.B2.records.filter(r => r.level !== 'high'); }],
    ['B3', M => { M.data.B3 = M.data.B3.filter(q => q.type !== 'purpose'); }],
    ['C3', M => { M.data.C3[0].truthSpeaker = 'Z'; }]
  ]) { const { M } = load(); corrupt(M); assert.throws(() => M.generators[id](M.random('invalid'))); }
});
