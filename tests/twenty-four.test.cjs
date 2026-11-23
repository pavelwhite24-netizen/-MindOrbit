'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const root = resolve(__dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');
const source = read('js/data/twenty-four.js');
const { CONTENT_VERSION, solveCards, generatePool, renderData } = require('../tools/generate-24.cjs');

function loadData(window = {}) {
  // Production data is a classic local script, with no BigInt/runtime library.
  const context = vm.createContext({ window, BigInt: undefined });
  vm.runInContext(source, context, { timeout: 1000 });
  return window.MindOrbit;
}
const loaded = loadData();
const pool = JSON.parse(JSON.stringify(loaded.twentyFour));

// Independent exact arithmetic: no Fraction.js or generator helper is used by
// this subset-DP oracle or the expression parser. The numerator carries sign.
function rational(n, d = 1n) {
  assert.notEqual(d, 0n, 'Division by zero');
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b !== 0n) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}

function calculate(a, operator, b) {
  switch (operator) {
    case '+': return rational(a.n * b.d + b.n * a.d, a.d * b.d);
    case '-': return rational(a.n * b.d - b.n * a.d, a.d * b.d);
    case '*': return rational(a.n * b.n, a.d * b.d);
    case '/': return rational(a.n * b.d, a.d * b.n);
    default: throw new Error(`Illegal binary operator: ${operator}`);
  }
}
const key = value => `${value.n}/${value.d}`;

function subsetSolvable(cards) {
  const dp = Array.from({ length: 16 }, () => new Map());
  for (let i = 0; i < 4; i += 1) {
    const value = rational(BigInt(cards[i]));
    dp[1 << i].set(key(value), value);
  }
  for (let mask = 1; mask < 16; mask += 1) {
    // Every proper ordered partition of a mask, with distinct card instances.
    // Enumerating both partitions preserves both subtraction/division orders.
    for (let left = (mask - 1) & mask; left; left = (left - 1) & mask) {
      const right = mask ^ left;
      for (const a of dp[left].values()) {
        for (const b of dp[right].values()) {
          for (const operator of ['+', '-', '*', '/']) {
            if (operator === '/' && b.n === 0n) continue;
            const value = calculate(a, operator, b);
            dp[mask].set(key(value), value);
          }
        }
      }
    }
  }
  return dp[15].has('24/1');
}

// Strict grammar: E := [1-9] | '(' E ('+' | '-' | '*' | '/') E ')'.
// Never eval an expression: reject concatenation, unary operators and all code.
function parseExpression(expression) {
  assert.equal(typeof expression, 'string');
  let index = 0;
  const leaves = [];
  let operators = 0;
  function parse() {
    const token = expression[index++];
    if (token && /^[1-9]$/.test(token)) {
      leaves.push(Number(token));
      return rational(BigInt(token));
    }
    assert.equal(token, '(', 'Expected card or opening parenthesis');
    const left = parse();
    const operator = expression[index++];
    assert.ok(['+', '-', '*', '/'].includes(operator), 'Expected legal binary operator');
    operators += 1;
    const right = parse();
    assert.equal(expression[index++], ')', 'Expected closing parenthesis');
    return calculate(left, operator, right);
  }
  const value = parse();
  assert.equal(index, expression.length, 'Unexpected trailing tokens');
  return { value, leaves: leaves.sort((a, b) => a - b), operators };
}

function verifyExpression(expression, cards) {
  const parsed = parseExpression(expression);
  assert.deepEqual(parsed.leaves, [...cards].sort((a, b) => a - b), 'Use each card instance exactly once');
  assert.equal(parsed.operators, 3);
  assert.deepEqual(parsed.value, rational(24n), 'Expression must equal exactly 24/1');
}

const upstreamHashes = {
  'vendor/fraction.cjs': '169542b29b6749b6f9a0a2a613ca2339b893d81f05a97ba46ed8aa0ee430299c',
  'vendor/fraction-LICENSE.txt': 'ea6916b674c353de0e9b84b9c91e3b3f8c620a1000d6a65662961b8a67840f19',
  'vendor/memory-original.js': 'c2756dd27124f5c5f6378c08d449d30e252eee7a8acf2e48fd7471cf52fc3dd6',
  'vendor/memory-LICENSE.txt': 'f378903fadd9e00a4ef832142c4a95271646b8a3fcb292746cfd0be39384d578',
  'vendor/lucide-LICENSE.txt': 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57',
  'assets/icons/brain.svg': '91830115f859daa12e7f2f63fc072311329e363bb8b0b4707f510bcb60c2ab18',
  'assets/icons/orbit.svg': 'e2b8b7d7f82044181860cbc2dab9b7e8d3c4778fbbce9a62f5c4038175f4faf4',
  'assets/icons/grid-2x2.svg': 'dc1896d3b22e88e0ba45a77bc8e947b7a01d0c9fb5ff77d07d24a5589816bb84',
  'assets/icons/chart-no-axes-combined.svg': '2f8a708c357488cfde7428d9b055b9bb4a99c08dc71e9296da03ecc19291c4ab',
  'assets/icons/settings-2.svg': '06d06c191bd7eb28afaf9d40acb5c49ef69448fdeda91801d9823d7c440a4e10',
  'assets/icons/arrow-right.svg': '288397fdb73bb4f783cf9eabb726ff47357df1d4e3f1201dd748090579f108b9',
  'assets/icons/chevron-left.svg': '83b0681aa38bf55e9d52a1e4b4cced624abe1fe7678ecafda133a574f1161d93',
  'assets/icons/zap.svg': '4c395891eab4d1e5627c5d414a16db037317cb2f12453de0f3a1130964c6d444',
  'assets/icons/focus.svg': 'd52fde05ccbd7bf629e05daeb8eadf824c85333aeca78e674db01493bc8b1f10',
  'assets/icons/calculator.svg': 'a6b191250b1ffabdf9fc9536662309f1b0f65336aa681d75bae9f1708baaefd0',
  'assets/icons/puzzle.svg': '6d80d0c3b214c96945ed0f1c6ee0e4c4ea3911c6cc91c75751fdba08c31eab02',
  'assets/icons/clock.svg': 'e9d3e3acf4d1c280fcf8092293439dc0a4756a908ceb859de144b12451cd1cb9',
  'assets/icons/check.svg': '7f33acc9a77a61659531044525fc008edebe215bf4dcf1c789c8674ad3277db0',
  'assets/icons/x.svg': '4a9cdab38fbb96162e7dace28e33f4ca0e49d8963a6162abc3d4691b7d675117'
};

test('pinned vendor code, complete licenses and SVGs retain acquired bytes', () => {
  for (const [file, hash] of Object.entries(upstreamHashes)) {
    const bytes = readFileSync(resolve(root, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, file);
  }
  assert.match(read('vendor/lucide-LICENSE.txt'), /ISC License/);
  assert.match(read('vendor/lucide-LICENSE.txt'), /The MIT License \(MIT\)/);
  assert.match(read('vendor/lucide-LICENSE.txt'), /2013-present Cole Bemis/);
});

test('all fourteen SVGs contain only static local geometry', () => {
  const allowedTags = new Set(['svg', 'path', 'circle', 'rect', 'line']);
  const allowedAttrs = new Set(['xmlns', 'width', 'height', 'viewBox', 'fill', 'stroke',
    'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'd', 'cx', 'cy', 'r',
    'x', 'y', 'rx', 'x1', 'x2', 'y1', 'y2']);
  const files = Object.keys(upstreamHashes).filter(file => file.endsWith('.svg'));
  assert.equal(files.length, 14);
  for (const file of files) {
    const svg = read(file);
    assert.match(svg, /^<svg\s/);
    assert.match(svg, /<\/svg>\s*$/);
    assert.doesNotMatch(svg, /<!|<\?|\bon\w+\s*=|\bhref\s*=|url\s*\(|javascript:|data:/i);
    for (const tag of svg.matchAll(/<\/?([\w:-]+)\b([^>]*)>/g)) {
      assert.ok(allowedTags.has(tag[1]), `${file}: tag ${tag[1]}`);
      for (const attr of tag[2].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
        assert.ok(allowedAttrs.has(attr[1]), `${file}: attribute ${attr[1]}`);
        if (attr[1] === 'xmlns') assert.equal(attr[2], 'http://www.w3.org/2000/svg');
        else assert.doesNotMatch(attr[2], /https?:|\/\//i);
      }
    }
  }
});

test('actual Fraction CommonJS interface stays exact beyond Number precision', () => {
  const Fraction = require('../vendor/fraction.cjs');
  assert.equal(typeof Fraction, 'function');
  const third = new Fraction(1n, 3n);
  assert.equal(third.add(1n, 6n).equals(1n, 2n), true);
  assert.equal(third.toFraction(), '1/3');
  for (const field of ['s', 'n', 'd']) assert.equal(typeof third[field], 'bigint');
  const huge = 9007199254740993123456789n;
  assert.equal(new Fraction(huge).add(1n).sub(huge).equals(1n), true);
  assert.equal(new Fraction(8n).div(new Fraction(3n).sub(new Fraction(8n).div(3n))).equals(24n), true);
  assert.equal(new Fraction(1n).sub(9n).mul(new Fraction(2n).sub(5n)).equals(24n), true);
  assert.throws(() => third.div(0n), /Division by Zero/);
});

test('generator rejects absent or fake BigInt before upstream fallback loads', () => {
  for (const BigInt of [undefined, Number]) {
    let required = false;
    assert.throws(() => vm.runInNewContext(read('tools/generate-24.cjs'), {
      BigInt,
      require() { required = true; throw new Error('Unexpected require'); }
    }), /requires native BigInt/);
    assert.equal(required, false);
  }
});

test('classic data script works offline and preserves an existing namespace', () => {
  assert.equal(loaded.twentyFourVersion, CONTENT_VERSION);
  const namespace = { sentinel: true };
  const window = { MindOrbit: namespace };
  assert.equal(loadData(window), namespace);
  assert.equal(namespace.sentinel, true);
  assert.equal(namespace.twentyFour.length, 495);
});

test('pool covers every multiset exactly once, in deterministic order', () => {
  // Independently enumerate all ordered deals, then canonicalize and deduplicate.
  const expected = new Set();
  for (let deal = 0; deal < 9 ** 4; deal += 1) {
    let remaining = deal;
    const cards = [];
    for (let i = 0; i < 4; i += 1) {
      cards.push(remaining % 9 + 1);
      remaining = Math.floor(remaining / 9);
    }
    expected.add(cards.sort((a, b) => a - b).join(''));
  }
  assert.equal(pool.length, 495);
  assert.deepEqual(pool.map(record => record.cards.join('')), [...expected].sort());
  assert.equal(new Set(pool.map(record => record.id)).size, 495);
  for (const record of pool) {
    assert.deepEqual(Object.keys(record), ['id', 'cards', 'solvable', 'expression']);
    assert.equal(record.id, `24-${record.cards.join('')}`);
    assert.equal(typeof record.solvable, 'boolean');
    assert.equal(record.solvable ? typeof record.expression : record.expression, record.solvable ? 'string' : null);
  }
  assert.equal(pool.filter(record => record.solvable).length, 404);
  assert.equal(pool.filter(record => !record.solvable).length, 91);
  assert.equal(pool.find(record => record.id === '24-1111').solvable, false);
  assert.equal(pool.find(record => record.id === '24-3388').solvable, true);
});

test('independent BigInt subset DP agrees with all 495 labels', () => {
  for (const record of pool) {
    assert.equal(subsetSolvable(record.cards), record.solvable, record.id);
  }
});

test('all 404 witnesses use exactly the four cards and equal 24/1', () => {
  for (const record of pool) {
    if (record.solvable) verifyExpression(record.expression, record.cards);
    else assert.equal(record.expression, null, record.id);
  }
});

test('strict verifier rejects invalid operations, card use and zero division', () => {
  verifyExpression('(8/(3-(8/3)))', [3, 3, 8, 8]);
  verifyExpression('((1-9)*(2-5))', [1, 2, 5, 9]);
  for (const expression of ['24', '-1', '(1+1+1)', '(8**3)', '(3!)', 'Math.sqrt(9)',
    '((8/0)+1)', '(1/(1-1))', '(8/(3-(8/3)));', '(8/(3-(8/3)))alert(1)']) {
    assert.throws(() => parseExpression(expression), expression);
  }
  assert.throws(() => verifyExpression('(8/(3-(8/3)))', [3, 3, 3, 8]));
  assert.throws(() => verifyExpression('((1+1)+(1+1))', [1, 1, 1, 1]));
});

test('pair solver validates input and handles repeated, fractional and reversed cards', () => {
  assert.equal(solveCards([1, 1, 1, 1]), null);
  for (const cards of [[3, 3, 8, 8], [8, 3, 8, 3], [1, 3, 4, 6], [5, 5, 5, 1], [6, 6, 6, 6]]) {
    verifyExpression(solveCards(cards), cards);
  }
  for (const invalid of [null, [], [1, 2, 3], [0, 1, 2, 3], [1, 2, 3, 10], [1, 2, 3, 4.5], ['1', 2, 3, 4]]) {
    assert.throws(() => solveCards(invalid), /four integer cards/);
  }
});

test('offline regeneration matches checked-in classic script byte for byte', () => {
  assert.equal(renderData(generatePool()), source);
});
