'use strict';

// Run serially: visibility checks activate another Chrome tab.
const { launch, clockScript } = require('./chrome-driver.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const base = 'http://127.0.0.1:4173/';
const screenshotDirectory = path.join(__dirname, 'screenshots');
const reportPath = path.join(__dirname, 'chrome-dashboard-results.json');
const ids = Array.from('ABCDEF', module => [1, 2, 3].map(n => module + n)).flat();
const report = {
  date: new Date().toISOString(), status: 'running', errorstatus: null,
  checks: [], widths: [], screenshots: [], goldenRecords: [],
  fixture: { synthetic: true, note: 'TEST DATA ONLY: dated copies of native-play records in launch() temporary profile; never a user browser.' }
};
let b;
const run = expression => b.evaluate(expression);
const advance = ms => run(`testClock.advance(${ms})`);
const text = selector => run(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
const count = selector => run(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
const records = () => run('Object.values(MindOrbit.store.data.games).flatMap(game => game.history)');
const closeEnough = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-8, `${message}: ${actual} != ${expected}`);

async function check(name, fn) {
  const entry = { name, status: 'running' };
  report.checks.push(entry);
  try {
    const details = await fn();
    entry.status = 'passed';
    if (details !== undefined) entry.details = details;
    console.log('PASS', name);
    return details;
  } catch (error) {
    entry.status = 'failed';
    entry.error = error.stack;
    throw error;
  }
}

async function clickRoute(selector, destination) {
  await b.click(selector);
  await b.waitFor(`MindOrbit.router.path === ${JSON.stringify(destination)}`);
  assert.equal(await run('location.hash'), '#' + destination);
}
async function reloadRoute(route) {
  await run(`location.hash = ${JSON.stringify('#' + route)}`);
  await b.waitFor(`MindOrbit.router.path === ${JSON.stringify(route)}`);
  const loaded = b.once('Page.loadEventFired');
  await b.send('Page.reload');
  await loaded;
  await b.waitFor(`MindOrbit.router.path === ${JSON.stringify(route)}`);
}
async function tab(name) {
  const destination = { home: '/', all: '/all', scores: '/scores/radar', settings: '/settings' }[name];
  await clickRoute(`.bottom-nav [data-nav="${name}"]`, destination);
  assert.equal(await count('.bottom-nav [aria-current="page"]'), 1);
  assert.equal(await run('document.querySelector(".bottom-nav [aria-current=page]").dataset.nav'), name);
}
async function scoreTab(name) {
  if (!await count('.score-tabs')) await tab('scores');
  await clickRoute(`.score-tabs a[href="#/scores/${name}"]`, '/scores/' + name);
  assert.equal(await count('.score-tabs [aria-current="page"]'), 1);
  assert.equal(await run('document.querySelector(".score-tabs [aria-current=page]").getAttribute("href")'), '#/scores/' + name);
}
async function assetsReady() {
  await b.waitFor('[...document.images].every(image => image.complete)');
  await run('document.fonts.ready.then(() => true)');
  const broken = await run('[...document.images].filter(image => !image.naturalWidth).map(image => image.src)');
  assert.deepEqual(broken, [], 'Missing illustration/icon; wait for the asset agent before running');
}
async function timersEmpty(message) {
  assert.equal(await run('testClock.timers'), 0, message);
}

// The expectation is independently aggregated here, not copied from a chart label.
function expectedPortrait(history) {
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const games = Object.fromEntries(ids.map(id => {
    const current = history.filter(record => record.gameId === id && record.rulesVersion === '1').slice(-5);
    return [id, { score: mean(current.map(record => record.score)), samples: current.length }];
  }));
  const modules = Array.from('ABCDEF', id => {
    const scores = ids.filter(game => game[0] === id).map(game => games[game].score).filter(value => value !== null);
    return { id, score: mean(scores), coverage: scores.length, complete: scores.length === 3 };
  });
  const coverage = Object.values(games).filter(game => game.score !== null).length;
  return { games, modules, coverage, score: coverage === 18 ? mean(modules.map(module => module.score)) : null };
}
async function portrait() {
  const actual = await run('MindOrbit.scoring.portrait(MindOrbit.store.data)');
  const expected = expectedPortrait(await records());
  assert.deepEqual(actual.games, expected.games);
  assert.deepEqual(actual.modules, expected.modules);
  assert.equal(actual.coverage, expected.coverage);
  assert.equal(actual.score, expected.score);
  return actual;
}
async function overviewAndBadges() {
  const value = await portrait();
  assert.equal(await count('.score-summary .summary-card'), 2);
  const summaries = await run('[...document.querySelectorAll(".summary-card strong")].map(node => node.textContent)');
  assert.deepEqual(summaries, [value.score === null ? '—' : value.score.toFixed(1), Math.round(value.coverage / 18 * 100) + '%']);
  assert.equal(await count('.badge-strip button'), 8);
  const conditions = await run(`['完成任意一局有效训练', ...MindOrbit.modules.map(module => '体验全部 3 款' + module.name + '游戏'), '连续 7 天完成有效训练']`);
  const unlocked = [(await records()).length > 0, ...value.modules.map(module => module.complete), await run('MindOrbit.store.data.streak.longest >= 7')];
  for (let i = 0; i < 8; i++) {
    const selector = `.badge-strip button:nth-child(${i + 1})`;
    await b.click(selector);
    assert.equal(await count('.badge-strip [aria-pressed="true"]'), 1);
    assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`), 'true');
    const detail = await text('.badge-detail');
    assert.ok(detail.includes(conditions[i]), `Badge ${i + 1}: ${detail}`);
    assert.ok(detail.includes(unlocked[i] ? '已解锁' : '未解锁'));
    assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).classList.contains('is-locked')`), !unlocked[i]);
  }
  return summaries;
}
async function radarMatches() {
  const value = await portrait();
  const dimensions = ['C', 'F', 'D', 'E', 'A', 'B'].map(id => value.modules.find(module => module.id === id));
  assert.deepEqual(await run('[...document.querySelectorAll(".radar tspan")].map(node => node.textContent)'), dimensions.map(module => module.score === null ? '—' : module.score.toFixed(1)));
  const dots = await run('[...document.querySelectorAll(".radar circle")].map(node => ({x:Number(node.getAttribute("cx")),y:Number(node.getAttribute("cy"))}))');
  const expectedDots = dimensions.flatMap((module, i) => module.score === null ? [] : [{ x: 210 + Math.sin(i * Math.PI / 3) * module.score, y: 160 - Math.cos(i * Math.PI / 3) * module.score }]);
  assert.equal(dots.length, expectedDots.length, 'Missing dimensions must not become zero-score dots');
  dots.forEach((dot, i) => { closeEnough(dot.x, expectedDots[i].x, 'Radar x'); closeEnough(dot.y, expectedDots[i].y, 'Radar y'); });
  assert.equal(await count('.radar-value'), dimensions.every(module => module.score !== null) ? 1 : 0, 'No fabricated polygon for missing dimensions');
  if (await count('.radar-value')) {
    const polygon = await run('document.querySelector(".radar-value").getAttribute("points").split(" ").map(pair => pair.split(",").map(Number))');
    polygon.forEach(([x, y], i) => { closeEnough(x, expectedDots[i].x, 'Polygon x'); closeEnough(y, expectedDots[i].y, 'Polygon y'); });
  }
}
async function progressMatches() {
  const value = await portrait();
  const rows = await run(`[...document.querySelectorAll('.progress-item')].map(row => { const bar = row.querySelector('[role=progressbar]'); return { value:bar.getAttribute('aria-valuenow'), text:bar.getAttribute('aria-valuetext'), width:bar.firstElementChild.style.width, label:row.querySelector('strong').textContent }; })`);
  assert.equal(rows.length, 7);
  [value.score, ...value.modules.map(module => module.score)].forEach((score, i) => {
    if (score === null) {
      assert.equal(rows[i].value, null, 'Untrained is not zero');
      assert.equal(rows[i].text, '无训练数据');
      assert.match(rows[i].label, /未解锁|未训练/);
      assert.equal(rows[i].width, '0%');
    } else {
      closeEnough(Number(rows[i].value), score, 'Progress aria value');
      assert.ok(Math.abs(parseFloat(rows[i].width) - score) < 0.001, 'Progress fill matches portrait');
      assert.ok(rows[i].label.startsWith(score.toFixed(1) + '%'));
    }
  });
}
async function emptyChart() {
  assert.equal(await count('.growth-area, .growth-line, .growth-point'), 0);
  assert.match(await text('.growth-chart'), /等待/);
  assert.match(await text('.chart-summary'), /暂无完整脑力值/);
}
async function localPK(empty) {
  const before = await run('MindOrbit.store.data.revision');
  await b.click('.pk-button');
  await b.click('.pk-button');
  assert.equal(await count('#personal-pk'), 1, 'Repeated PK clicks do not duplicate panels');
  assert.match(await text('#personal-pk'), /仅对比本机/);
  assert.match(await text('#personal-pk'), /不提供联网匹配或他人排名/);
  assert.equal(await count('#personal-pk .empty-state'), empty ? 1 : 0);
  if (empty) {
    assert.match(await text('#personal-pk .empty-state'), /两局/);
    await clickRoute('#personal-pk a[href="#/all"]', '/all');
  } else {
    const expected = await run(`Object.values(MindOrbit.games).map(game => ({ game, history:MindOrbit.store.data.games[game.id].history.filter(record => record.rulesVersion === game.rulesVersion).slice(-2) })).filter(item => item.history.length === 2).map(({game,history}) => ({name:game.name,scores:history[0].score+' → '+history[1].score+' 分',delta:(history[1].score-history[0].score>0?'+':'')+(history[1].score-history[0].score)+' 分',href:'#/rules/'+game.id}))`);
    const actual = await run(`[...document.querySelectorAll('#personal-pk .history-row')].map(row => ({name:row.children[0].textContent,scores:row.children[1].textContent,delta:row.children[2].textContent,href:row.querySelector('a').getAttribute('href')}))`);
    assert.equal(actual.length, 18);
    assert.deepEqual(actual, expected);
    assert.ok(actual.some(row => row.delta === '+100 分'), 'Fixture must exercise a nonzero local comparison');
    await clickRoute('#personal-pk a[href="#/rules/E2"]', '/rules/E2');
  }
  assert.equal(await run('MindOrbit.store.data.revision'), before, 'PK is read-only, not matchmaking');
}

async function wellness(kind) {
  await tab('all');
  await clickRoute(`.category-tabs a[href="#/all/${kind}"]`, '/all/' + kind);
  const before = await run('JSON.stringify({games:MindOrbit.store.data.games,streak:MindOrbit.store.data.streak})');
  const duration = kind === 'meditation' ? 60000 : 300000;
  const initial = kind === 'meditation' ? '01:00' : '05:00';
  assert.equal(await text('.timer-display'), kind === 'meditation' ? '03:00' : '25:00');
  await b.click('.duration-options button:first-child');
  assert.equal(await count('.duration-options [aria-pressed="true"]'), 1);
  assert.equal(await text('.timer-display'), initial);
  await b.click('[data-action="start"]');
  assert.equal(await text('[data-action="start"]'), '暂停');
  assert.equal(await count('.duration-options button:disabled'), 3);
  await advance(10000);
  const pausedAt = await text('.timer-display');
  assert.equal(pausedAt, kind === 'meditation' ? '00:50' : '04:50');
  await b.click('[data-action="start"]');
  assert.equal(await text('[data-action="start"]'), '继续');
  assert.match(await text('.wellness-card [role="status"]'), /已暂停/);
  await timersEmpty(kind + ' manual pause');
  await advance(5000);
  assert.equal(await text('.timer-display'), pausedAt);
  await b.click('[data-action="start"]');
  await advance(1000);
  assert.notEqual(await text('.timer-display'), pausedAt);
  await b.click('[data-action="reset"]');
  await timersEmpty(kind + ' running reset');
  assert.equal(await text('.timer-display'), initial);
  assert.match(await text('[data-action="start"]'), /^开始/);
  await b.click('[data-action="start"]');
  await advance(3000);
  const hiddenAt = await text('.timer-display');
  let other;
  try {
    other = await b.send('Target.createTarget', { url: 'about:blank' });
    await b.send('Target.activateTarget', { targetId: other.targetId });
    await b.waitFor('document.hidden && document.querySelector("[data-action=start]").textContent === "继续"');
    assert.match(await text('.wellness-card [role="status"]'), /离开前台.*暂停/);
    await advance(duration);
    assert.equal(await text('.timer-display'), hiddenAt, 'Real hidden tab freezes remaining time');
    await timersEmpty(kind + ' hidden pause');
  } finally {
    await b.send('Target.activateTarget', { targetId: b.targetId });
    if (other) await b.send('Target.closeTarget', { targetId: other.targetId });
    await b.waitFor('!document.hidden');
  }
  assert.equal(await text('[data-action="start"]'), '继续', 'Foreground does not auto-resume');
  await b.click('[data-action="start"]');
  await advance(duration);
  assert.equal(await text('.timer-display'), '00:00');
  assert.equal(await text('[data-action="start"]'), '再来一次');
  assert.match(await text('.wellness-card [role="status"]'), /完成/);
  await timersEmpty(kind + ' completion');
  await b.click('[data-action="reset"]');
  assert.equal(await text('.timer-display'), initial);
  await b.click('[data-action="start"]');
  await advance(1000);
  await clickRoute('.category-tabs a[href="#/all"]', '/all');
  await timersEmpty(kind + ' route cleanup');
  await advance(duration * 2);
  await timersEmpty(kind + ' no late callbacks');
  assert.equal(await run('JSON.stringify({games:MindOrbit.store.data.games,streak:MindOrbit.store.data.streak})'), before, 'Wellness must not award scores or streaks');
  await clickRoute(`.category-tabs a[href="#/all/${kind}"]`, '/all/' + kind);
  assert.equal(await text('.timer-display'), kind === 'meditation' ? '03:00' : '25:00');
  await tab('home');
  await timersEmpty(kind + ' fresh visit cleanup');
}

async function begin(id) {
  await tab('all');
  await clickRoute(`.catalog-card[data-game="${id}"] .game-cover`, '/rules/' + id);
  assert.equal(await text('h1'), await run(`MindOrbit.games[${JSON.stringify(id)}].name`));
  await clickRoute(`a[href="#/play/${id}"]`, '/play/' + id);
  assert.equal(await run('MindOrbit.host.state'), 'preparing');
  await advance(3000);
  assert.equal(await run('MindOrbit.host.state'), 'running');
}
async function finishedRecord(id, score) {
  await b.waitFor('MindOrbit.host.state === "finished" && MindOrbit.router.path.startsWith("/result/")');
  const record = await run(`MindOrbit.store.data.games[${JSON.stringify(id)}].history.at(-1)`);
  assert.equal(record.gameId, id);
  assert.equal(record.rulesVersion, '1');
  assert.equal(record.score, score);
  assert.equal(await run(`MindOrbit.storage.validRecord(${JSON.stringify(record)}, ${JSON.stringify(id)})`), true);
  assert.equal(await run(`MindOrbit.scoring.game(${JSON.stringify(id)}, ${JSON.stringify(record.metrics)})`), score);
  assert.match(await text('.save-state'), /已保存/);
  assert.equal(await text('.score-circle strong'), String(score));
  await timersEmpty(id + ' finished game');
  return record;
}
async function golden(id) {
  await begin(id);
  const option = index => b.click(`.answer-options .answer-button:nth-child(${index + 1})`);
  const generated = name => run(`MindOrbit.generators[${JSON.stringify(name)}](window.__dashboardOriginalRandom(window.__dashboardSeed))`);
  if (id === 'A1') {
    for (let size = 3; size <= 8; size++) {
      const cells = await run('[...document.querySelectorAll(".grid-cell.lit")].map(node => node.dataset.index)');
      assert.equal(cells.length, size);
      await advance(1500);
      for (const index of cells) await b.click(`.grid-cell[data-index="${index}"]`);
      await b.click('.game-arena > .answer-button');
      await advance(500);
    }
  } else if (id === 'A2') {
    for (let size = 3; size <= 9; size++) {
      let sequence = '';
      for (let i = 0; i < size; i++) { sequence += await text('.digit-display'); await advance(800); }
      for (const character of sequence) await b.key(character, 'Digit' + character, character.charCodeAt(0));
      await b.key('Enter', 'Enter', 13);
      await advance(500);
    }
  } else if (id === 'A3') {
    const layout = await generated('memoryPairs');
    for (const value of new Set(layout)) {
      for (let i = 0; i < layout.length; i++) if (layout[i] === value) await b.click(`.grid-cell[data-index="${i}"]`);
    }
  } else if (id === 'D1') {
    for (let i = 0; i < 5; i++) {
      for (let step = 0; step < 210 && await run('MindOrbit.host.stage') !== 'answering'; step++) await advance(20);
      assert.equal(await run('MindOrbit.host.stage'), 'answering');
      await advance(150);
      await b.click('.reaction-pad');
      await advance(500);
    }
  } else if (id === 'D3') {
    await advance(16);
    for (let i = 0; i < 15; i++) { await b.click('.grid-cell.lit'); await advance(i === 14 ? 1984 : 2000); }
  } else if (id === 'E1') {
    const sequence = await generated('E1');
    await advance(4000);
    for (let i = 2; i < 25; i++) { await advance(600); await option(sequence[i] === sequence[i - 2] ? 0 : 1); await advance(1400); }
  } else if (id === 'E2') {
    const layout = await run('[...document.querySelectorAll(".grid-cell")].map(node => Number(node.textContent))');
    for (let n = 1; n <= 25; n++) {
      await advance(100);
      const selector = `.grid-cell[data-index="${layout.indexOf(n)}"]`;
      if (n === 1) {
        // Only focus is scripted; activation is a native keyboard event.
        await run(`document.querySelector(${JSON.stringify(selector)}).focus()`);
        await b.key('Enter', 'Enter', 13);
      } else await b.click(selector);
    }
  } else if (id === 'E3') {
    for (let i = 0; i < 6; i++) {
      const index = await run(`(() => { const nodes = [...document.querySelectorAll('.grid-cell')]; return nodes.findIndex(node => nodes.filter(other => other.textContent === node.textContent).length === 1); })()`);
      assert.ok(index >= 0);
      await advance(100);
      await b.click(`.grid-cell[data-index="${index}"]`);
      await advance(500);
    }
  } else if (id === 'F2') {
    for (let length = 3; length <= 7; length++) {
      let sum = 0;
      for (let i = 0; i < length; i++) { sum += Number(await text('.digit-display')); await advance(900); }
      const index = await run(`[...document.querySelectorAll('.answer-options .answer-button')].findIndex(node => Number(node.lastChild.textContent) === ${sum})`);
      assert.ok(index >= 0);
      await option(index);
      await advance(500);
    }
  } else {
    for (const question of await generated(id === 'D2' ? 'stroop' : id)) {
      await advance(100);
      await option(question.answer);
      await advance(500);
    }
  }
  return finishedRecord(id, 100);
}

async function selectGame(id) {
  const index = await run(`[...document.querySelector('.history-select').options].findIndex(option => option.value === ${JSON.stringify(id)})`);
  assert.ok(index >= 0);
  await b.click('.history-select');
  // Close the native popup, retain focus, and change the real select with keys.
  await b.key('Escape', 'Escape', 27);
  await b.key('Home', 'Home', 36);
  for (let i = 0; i < index; i++) await b.key('ArrowDown', 'ArrowDown', 40);
  await b.key('Enter', 'Enter', 13);
  await b.key('Escape', 'Escape', 27);
  await b.waitFor(`document.querySelector('.history-select').value === ${JSON.stringify(id)}`);
}
async function chartRange(range, timeline) {
  await b.click(`.chart-range [data-range="${range}"]`);
  assert.equal(await count('.chart-range [aria-pressed="true"]'), 1);
  assert.equal(await run('document.querySelector(".chart-range [aria-pressed=true]").dataset.range'), range);
  const today = await run('MindOrbit.storage.dayNumber(MindOrbit.storage.localDay(new Date()))');
  const points = timeline.filter(point => range === 'all' || (Date.parse(point.day + 'T00:00:00Z') / 86400000 <= today && Date.parse(point.day + 'T00:00:00Z') / 86400000 > today - Number(range)));
  const labels = await run('[...document.querySelectorAll(".growth-point")].map(node => node.getAttribute("aria-label"))');
  assert.deepEqual(labels, points.map(point => `${point.day} 总脑力值 ${point.score.toFixed(1)}`));
  assert.equal(await count('.growth-area'), points.length > 1 ? 1 : 0);
  assert.equal(await count('.growth-line'), points.length > 1 ? 1 : 0);
  const coordinates = await run('[...document.querySelectorAll(".growth-point")].map(node => Number(node.getAttribute("cy")))');
  coordinates.forEach((y, i) => closeEnough(y, 252 - points[i].score * 2, 'Growth y reflects actual portrait'));
  assert.ok(!(await text('.growth-chart')).includes('等待'));
  assert.ok((await text('.chart-summary')).startsWith(points.length + ' 个训练日'));
  assert.equal(await run('[...document.querySelectorAll(".growth-chart path")].some(node => /NaN|Infinity/.test(node.getAttribute("d")))'), false);
  return points.length;
}

async function reachable(selector) {
  const detail = await run(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) throw new Error('Missing important control: ' + ${JSON.stringify(selector)});
    node.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const rect = node.getBoundingClientRect(), nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2, hit = document.elementFromPoint(x,y);
    return {selector:${JSON.stringify(selector)},left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height,navTop:nav.top,hit:!!hit && (hit === node || node.contains(hit)),viewport:innerWidth};
  })()`);
  assert.ok(detail.width > 0 && detail.height > 0, selector + ' visible');
  assert.ok(detail.top >= -1 && detail.bottom <= detail.navTop + 1, selector + ' is reachable above the fixed navigation');
  assert.ok(detail.left >= -1 && detail.right <= detail.viewport + 1, selector + ' fits horizontally');
  assert.equal(detail.hit, true, selector + ' is not covered');
  return detail;
}
async function gridColumns() {
  const grids = await run(`[...document.querySelectorAll('.catalog-grid')].map(grid => ({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,cards:[...grid.children].map(node => {const rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,width:rect.width};})}))`);
  assert.ok(grids.length > 0);
  for (const grid of grids) {
    assert.equal(grid.columns, 3, 'Catalog stays three columns, including 320px');
    if (grid.cards.length === 3) {
      assert.ok(grid.cards.every(card => Math.abs(card.y - grid.cards[0].y) < 1), 'Three cards share one row');
      assert.equal(new Set(grid.cards.map(card => Math.round(card.x))).size, 3);
      assert.ok(grid.cards.every(card => card.width > 0));
    }
  }
  return grids;
}
async function capture(page, device) {
  if (page === 'home' || page === 'all') await tab(page);
  else { await tab('scores'); await scoreTab(page); }
  await assetsReady();
  const measure = await run('({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,height:innerHeight})');
  const widthEntry = { page, device: device.name, requestedWidth: device.width, ...measure, status: 'running', controls: [] };
  report.widths.push(widthEntry);
  assert.equal(measure.width, device.width, 'Viewport must not silently expand');
  assert.ok(measure.scrollWidth <= measure.width && measure.bodyWidth <= measure.width, `${page}/${device.name} horizontal overflow`);
  if (page === 'all') widthEntry.grids = await gridColumns();
  const controls = {
    home: ['.start-button', '.quick-card[href="#/favorites"]', '.plan-card:last-child'],
    all: ['.category-tabs a:last-child', '.catalog-section:last-child .catalog-card:last-child .game-cover', '.catalog-section:last-child .catalog-card:last-child .favorite-button', '.catalog-section:last-child .catalog-card:last-child .game-name'],
    radar: ['.badge-strip button:last-child', '.score-tabs a:last-child', '.pk-button'],
    records: ['.chart-range button:last-child', '.history-select', '.history-content .history-row:last-child', '.history-content > button'],
    progress: ['.score-tabs a:last-child', '.progress-item:last-child .progress-track']
  }[page];
  for (const selector of controls) widthEntry.controls.push(await reachable(selector));
  const nav = await run(`[...document.querySelectorAll('.bottom-nav a')].map(node => {const rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return {visible:rect.top>=0&&rect.bottom<=innerHeight+1&&rect.left>=0&&rect.right<=innerWidth+1,hit:!!hit&&node.contains(hit)};})`);
  assert.equal(nav.length, 4);
  assert.ok(nav.every(item => item.visible && item.hit), 'All four bottom tabs remain visible and usable');
  // Controls above intentionally scroll. Always reset before every screenshot.
  await run('window.scrollTo(0,0)');
  const top = await run('({scroll:scrollY,headingTop:document.querySelector("h1").getBoundingClientRect().top,headingBottom:document.querySelector("h1").getBoundingClientRect().bottom,navTop:document.querySelector(".bottom-nav").getBoundingClientRect().top})');
  assert.equal(top.scroll, 0);
  assert.ok(top.headingTop >= 0 && top.headingBottom < top.navTop, 'Screenshot retains page heading');
  const filename = path.join(screenshotDirectory, `dashboard-${page}-${device.name}.png`);
  await b.screenshot(filename);
  report.screenshots.push({ page, device: device.name, width: device.width, path: filename, scrollY: top.scroll, fixture: 'dated native-play copies (test data)' });
  if (['radar', 'records', 'progress'].includes(page)) {
    await run('document.querySelector(".score-panel").scrollIntoView({block:"start",behavior:"instant"})');
    const detail = path.join(screenshotDirectory, `dashboard-${page}-${device.name}-detail.png`);
    await b.screenshot(detail);
    report.screenshots.push({ page, device: device.name, width: device.width, path: detail, scrollY: await run('scrollY'), fixture: 'dated native-play copies (test data)' });
  }
  widthEntry.status = 'passed';
}

async function main() {
  const httpErrors = [];
  fs.mkdirSync(screenshotDirectory, { recursive: true });
  try {
    await check('local server available (start tools/serve.cjs separately)', async () => {
      const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    });
    b = await launch();
    report.browser = b.version.Browser;
    report.profile = b.profile;
    assert.equal(path.dirname(path.resolve(b.profile)), path.resolve(os.tmpdir()));
    assert.match(path.basename(b.profile), /^mindorbit-chrome-/);
    b.on('Network.responseReceived', event => { if (event.response.status >= 400) httpErrors.push({ url: event.response.url, status: event.response.status }); });
    await b.send('Page.addScriptToEvaluateOnNewDocument', { source: clockScript });
    await b.navigate(base);
    await b.waitFor('window.MindOrbit?.router.path === "/"');
    await check('isolated fresh profile and loaded assets', async () => {
      assert.deepEqual(await records(), []);
      assert.equal(await run('MindOrbit.store.persistent'), true);
      assert.deepEqual(await run('Object.keys(MindOrbit.games).sort()'), ids);
      await assetsReady();
    });
    await check('four bottom tabs navigate through native clicks', async () => {
      assert.equal(await count('.bottom-nav a'), 4);
      for (const name of ['all', 'scores', 'settings', 'home']) await tab(name);
    });
    await check('seven dates, exclusive aria-pressed, blue daily plan, today/start link', async () => {
      const days = await run('[...document.querySelectorAll(".day-button")].map(node => node.dataset.day)');
      const today = await run('MindOrbit.storage.localDay(new Date())');
      assert.equal(days.length, 7);
      assert.equal(new Set(days).size, 7);
      assert.equal(await count('.day-button[aria-current="date"]'), 1);
      assert.equal(await text('.ring-copy strong'), '0/3');
      const blue = await run(`(() => {const style=getComputedStyle(document.querySelector('.daily-hero'));return {color:style.backgroundColor,image:style.backgroundImage};})()`);
      const colors = [...(blue.color + ' ' + blue.image).matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)];
      assert.ok(colors.some(color => Number(color[3]) > Number(color[1]) + 30), 'Daily plan must have a blue surface');
      for (const day of days) {
        await b.click(`.day-button[data-day="${day}"]`);
        assert.equal(await count('.day-button[aria-pressed="true"]'), 1);
        assert.equal(await run('document.querySelector(".day-button[aria-pressed=true]").dataset.day'), day);
        const plan = await run(`(() => {const number=MindOrbit.storage.dayNumber(${JSON.stringify(day)}),offset=((number%6)+6)%6;return [0,2,4].map((step,i)=>MindOrbit.modules[(offset+step)%6].id+(1+((number+i)%3+3)%3));})()`);
        assert.deepEqual(await run('[...document.querySelectorAll(".plan-tags span")].map(node => node.textContent)'), await run(`${JSON.stringify(plan)}.map(id => MindOrbit.games[id].name)`));
        assert.equal(await text('.ring-copy strong'), '0/3');
        if (day === today) assert.equal(await run('document.querySelector(".start-button").getAttribute("href")'), '#/rules/' + plan[0]);
        else {
          assert.equal(await run('document.querySelector(".start-button").tagName'), 'BUTTON');
          assert.match(await text('.start-button'), /回到今日/);
          assert.match(await text('.hero-footnote'), day < today ? /不补签|历史/ : /未来|实际完成日期/);
          await b.click('.start-button');
          assert.equal(await run('document.querySelector(".day-button[aria-pressed=true]").dataset.day'), today);
        }
      }
      // Also activate a date using native Space, without dispatchEvent/DOM click().
      await run(`document.querySelector('.day-button[data-day="${days.find(day => day !== today)}"]').focus()`);
      await b.key(' ', 'Space', 32);
      assert.notEqual(await run('document.querySelector(".day-button[aria-pressed=true]").dataset.day'), today);
      await b.click('.start-button');
      const href = await run('document.querySelector(".start-button").getAttribute("href")');
      await clickRoute('.start-button', href.slice(1));
      assert.equal(await count('.rules-card'), 1);
      await tab('home');
    });
    for (const name of ['radar', 'records', 'progress']) await check(`empty scores/${name}: shared two cards/eight badge conditions and no invented scores`, async () => {
      await scoreTab(name);
      await overviewAndBadges();
      if (name === 'radar') { await radarMatches(); await localPK(true); }
      if (name === 'records') {
        await emptyChart();
        assert.equal(await count('.history-content .history-row'), 0);
        assert.match(await text('.history-content .empty-state'), /还没有训练记录/);
        for (const range of ['7', '30', 'all']) { await b.click(`.chart-range [data-range="${range}"]`); await emptyChart(); }
      }
      if (name === 'progress') await progressMatches();
    });
    await check('catalog: 18 games, six modules, three columns and four real categories', async () => {
      await tab('all');
      assert.deepEqual(await run('[...document.querySelectorAll(".catalog-card")].map(node => node.dataset.game).sort()'), ids);
      assert.deepEqual(await run('[...document.querySelectorAll(".catalog-section")].map(node => ({id:node.dataset.module,count:node.querySelectorAll(".catalog-card").length}))'), Array.from('ABCDEF', id => ({ id, count: 3 })));
      assert.equal(await count('.category-tabs a'), 4);
      await gridColumns();
      await assetsReady();
      await clickRoute('.category-tabs a[href="#/all/advanced"]', '/all/advanced');
      assert.deepEqual(await run('[...document.querySelectorAll(".catalog-card")].map(node => node.dataset.game).sort()'), ['A2', 'B1', 'C3', 'E1', 'F2', 'F3']);
      assert.equal(await run('document.querySelector(".category-tabs [aria-current=page]").getAttribute("href")'), '#/all/advanced');
      await clickRoute('.category-tabs a[href="#/all"]', '/all');
    });
    await check('favorites: empty, add, persisted reload, native remove, persisted empty', async () => {
      await tab('home');
      await clickRoute('.quick-card[href="#/favorites"]', '/favorites');
      assert.match(await text('.empty-state'), /还没有收藏/);
      await clickRoute('a[href="#/all"].text-link', '/all');
      const selector = '.catalog-card[data-game="E2"] .favorite-button';
      await b.click(selector);
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`), 'true');
      await b.navigate(base + '#/all');
      assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-pressed')`), 'true');
      assert.deepEqual(await run('MindOrbit.store.data.settings.favorites'), ['E2']);
      await tab('home');
      assert.match(await text('.quick-card[href="#/favorites"]'), /1 款/);
      await clickRoute('.quick-card[href="#/favorites"]', '/favorites');
      assert.equal(await count('.catalog-card'), 1);
      await b.click(selector);
      assert.equal(await count('.catalog-card'), 0);
      assert.match(await text('.empty-state'), /还没有收藏/);
      await b.navigate(base + '#/favorites');
      assert.deepEqual(await run('MindOrbit.store.data.settings.favorites'), []);
      assert.match(await text('.empty-state'), /还没有收藏/);
    });
    for (const kind of ['meditation', 'timer']) await check(`${kind}: start/pause/resume/reset/finish, actual background pause, cleanup/no scores`, () => wellness(kind));

    const goldens = {};
    await check('E2 native keyboard/pointer completion saves real metrics and immediately updates dashboard', async () => {
      goldens.E2 = await golden('E2');
      assert.equal(goldens.E2.metrics.completed, true);
      assert.equal(goldens.E2.metrics.progress, 25);
      assert.equal(goldens.E2.inputMode, 'mixed');
      assert.equal((await records()).length, 1);
      await tab('home');
      assert.equal(await text('.daily-stats .stat:last-child strong'), '1 次');
      assert.match(await text('.plan-card[href="#/module/E"] .plan-meta'), /1\/3/);
      await tab('scores');
      await overviewAndBadges();
      await radarMatches();
      assert.equal(await count('.radar circle'), 1);
      await scoreTab('progress');
      await progressMatches();
      await scoreTab('records');
      await emptyChart();
      assert.equal(await count('.history-row'), 1);
      await reloadRoute('/scores/radar');
      assert.equal((await records()).length, 1);
      await radarMatches();
      assert.equal(await run('MindOrbit.storage.validate(MindOrbit.store.data)'), true);
    });
    // Reimplement the golden native operations from chrome-games.cjs. Capture the
    // production RNG seed only in this isolated page; restore it before fixtures.
    await run(`window.__dashboardOriginalRandom=MindOrbit.random;MindOrbit.random=seed=>{window.__dashboardSeed=seed;return window.__dashboardOriginalRandom(seed);}`);
    try {
      for (const id of ids.filter(id => id !== 'E2')) await check(`native golden ${id}: valid v1 metrics, saved 100, no pending timers`, async () => {
        goldens[id] = await golden(id);
        return { gameId: id, score: goldens[id].score, durationMs: goldens[id].durationMs };
      });
    } finally {
      await run('MindOrbit.random=window.__dashboardOriginalRandom;delete window.__dashboardOriginalRandom;delete window.__dashboardSeed;');
    }
    report.goldenRecords = ids.map(id => goldens[id]);
    await check('completed daily plan, streak and lifetime count update from native games and survive reload', async () => {
      await tab('home');
      for (let attempt = 0; attempt < 2; attempt++) {
        assert.equal(await text('.ring-copy strong'), '3/3');
        assert.match(await text('.start-button'), /再练一次/);
        assert.equal(await run('[...document.querySelectorAll(".plan-tags span")].filter(node => node.textContent.includes("已完成")).length'), 3);
        assert.deepEqual(await run('[...document.querySelectorAll(".daily-stats strong")].map(node => node.textContent)'), ['100.0', '1 天', '18 次']);
        assert.equal(await count('.day-button[aria-current="date"] .day-dot.done'), 1);
        if (!attempt) await reloadRoute('/');
      }
    });
    let timeoutRecord;
    await check('real E2 no-input result supplies a legal zero-score PK comparison', async () => {
      await begin('E2');
      await advance(120000);
      timeoutRecord = await finishedRecord('E2', 0);
      assert.equal(timeoutRecord.metrics.completed, false);
      assert.equal(timeoutRecord.outcome, 'timeout');
    });
    let timeline;
    await check('isolated test fixture: three distinct dates x 18 valid games, stats and portrait survive reload', async () => {
      const fixture = await run(`(() => {
        const M=MindOrbit, goldens=${JSON.stringify(goldens)}, timeout=${JSON.stringify(timeoutRecord)}, ids=${JSON.stringify(ids)}, now=new Date();
        if(!M.store.reset())throw new Error('Cannot reset isolated test profile');
        const manifest=[];
        for(const [dayIndex,offset] of [40,10,1].entries()) {
          for(const [index,id] of ids.entries()) {
            const date=new Date(now.getFullYear(),now.getMonth(),now.getDate()-offset,10,index);
            const record=JSON.parse(JSON.stringify(id==='E2'&&dayIndex===1?timeout:goldens[id]));
            record.sessionId='dashboard-fixture-'+dayIndex+'-'+id;
            record.completedAt=date.toISOString();record.localDay=M.storage.localDay(date);record.utcOffsetMinutes=-date.getTimezoneOffset();
            if(!M.storage.validRecord(record,id))throw new Error('Invalid fixture '+id);
            if(!M.store.save(record).saved)throw new Error('Fixture save failed '+id);
            manifest.push({gameId:id,day:record.localDay,score:record.score,sessionId:record.sessionId});
          }
        }
        return {manifest,valid:M.storage.validate(M.store.data)};
      })()`);
      assert.equal(fixture.valid, true);
      report.fixture.records = fixture.manifest;
      await reloadRoute('/scores/radar');
      assert.equal(await run('MindOrbit.store.persistent'), true);
      assert.equal(await run('MindOrbit.storage.validate(MindOrbit.store.data)'), true);
      const history = await records();
      assert.equal(history.length, 54);
      assert.equal(new Set(history.map(record => record.localDay)).size, 3);
      for (const day of new Set(history.map(record => record.localDay))) assert.deepEqual(history.filter(record => record.localDay === day).map(record => record.gameId).sort(), ids);
      for (const id of ids) {
        const stats = await run(`MindOrbit.store.data.games['${id}'].statsByRulesVersion['1']`);
        assert.equal(stats.completedCount, 3);
        assert.equal(stats.bestScore, 100);
        assert.equal(stats.lastCompletedAt, history.filter(record => record.gameId === id).at(-1).completedAt);
      }
      assert.equal(await run('Object.values(MindOrbit.store.data.games).flatMap(game=>game.history).every(record=>record.rulesVersion==="1" && !!record.completedAt && record.localDay===MindOrbit.storage.localDay(new Date(record.completedAt)) && MindOrbit.storage.validRecord(record,record.gameId))'), true);
      report.fixture.portrait = await portrait();
      closeEnough(report.fixture.portrait.score, 100 - 100 / 54, 'Three-day equal-weight score');
      timeline = await run('MindOrbit.scoring.timeline(MindOrbit.store.data)');
      assert.equal(timeline.length, 3);
      for (const point of timeline) {
        assert.equal(point.coverage, 18);
        const snapshot = history.filter(record => record.localDay <= point.day).sort((a, c) => Date.parse(a.completedAt) - Date.parse(c.completedAt));
        closeEnough(point.score, expectedPortrait(snapshot).score, 'Daily timeline reconstructed from actual records');
      }
      report.fixture.timeline = timeline;
    });
    let shared;
    for (const name of ['radar', 'records', 'progress']) await check(`populated scores/${name}: common overview/badges and scoring-consistent content`, async () => {
      await scoreTab(name);
      const current = await overviewAndBadges();
      if (shared) assert.deepEqual(current, shared); else shared = current;
      if (name === 'radar') { await radarMatches(); await localPK(false); }
      if (name === 'records') assert.equal(await chartRange('all', timeline), 3);
      if (name === 'progress') await progressMatches();
    });
    await check('records: native 7/30/all chart filtering, native game select, show-more and result link', async () => {
      await scoreTab('records');
      const counts = [];
      for (const range of ['7', '30', 'all']) counts.push(await chartRange(range, timeline));
      assert.deepEqual(counts, [1, 2, 3]);
      // These range buttons filter the chart, not the separately-labelled recent records.
      assert.equal(await count('.history-content .history-row'), 30);
      await selectGame('E2');
      assert.equal(await count('.history-content .history-row'), 3);
      const rows = await run('[...document.querySelectorAll(".history-content .history-row")].map(node => ({name:node.children[0].textContent,score:node.querySelector("strong").textContent}))');
      const name = await run('MindOrbit.games.E2.name');
      assert.deepEqual(rows, [100, 0, 100].map(score => ({ name, score: score + ' 分' })));
      assert.equal(await run('document.querySelector(".history-content > button").hidden'), true);
      await selectGame('all');
      assert.equal(await count('.history-content .history-row'), 30);
      await b.click('.history-content > button');
      assert.equal(await count('.history-content .history-row'), 54);
      assert.equal(await run('document.querySelector(".history-content > button").hidden'), true);
      const href = await run('document.querySelector(".history-content .history-row").getAttribute("href")');
      await clickRoute('.history-content .history-row', href.slice(1));
      assert.equal(await count('.result-card'), 1);
      assert.match(await text('.save-state'), /已保存/);
      return { ranges: { '7': counts[0], '30': counts[1], all: counts[2] }, gameFilter: 'E2', totalRows: 54 };
    });
    await check('legacy /history still exposes real history rows and result links', async () => {
      await reloadRoute('/history');
      assert.equal(await run('MindOrbit.router.path'), '/history');
      assert.equal(await count('.history-row'), 30);
      assert.equal(await run('document.querySelector(".score-tabs [aria-current=page]").getAttribute("href")'), '#/scores/records');
      assert.equal(await run('document.querySelector(".bottom-nav [aria-current=page]").dataset.nav'), 'scores');
      await b.click('.history-content > button');
      assert.equal(await count('.history-row'), 54);
    });
    for (const device of [
      { name: 'desktop', width: 1365, height: 960, mobile: false },
      { name: 'mobile', width: 390, height: 844, mobile: true },
      { name: 'mobile-320', width: 320, height: 800, mobile: true }
    ]) {
      await b.send('Emulation.setDeviceMetricsOverride', { width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.mobile });
      for (const page of ['home', 'all', 'radar', 'records', 'progress']) await check(`layout/screenshot ${page} ${device.width}px: no overflow, accessible controls, header retained`, () => capture(page, device));
    }
    await check('final route cleanup leaves no scheduled application timers', async () => { await tab('home'); await advance(120000); await timersEmpty('Final cleanup'); });
  } catch (error) {
    report.errorstatus = { name: error.name, message: error.message, stack: error.stack };
    for (const width of report.widths) if (width.status === 'running') { width.status = 'failed'; width.error = error.message; }
    if (b) {
      try {
        const filename = path.join(screenshotDirectory, 'dashboard-failure.png');
        await run('window.scrollTo(0,0)');
        await b.screenshot(filename);
        report.screenshots.push({ path: filename, failure: true });
      } catch (captureError) { report.failureScreenshotError = captureError.message; }
    }
  } finally {
    if (b) {
      report.consoleErrors = [...b.errors];
      report.requests = [...new Set(b.requests)];
      report.httpErrors = httpErrors;
      report.externalRequests = report.requests.filter(url => !url.startsWith(base));
      try {
        await check('no uncaught/console errors, missing resources or external requests', async () => {
          assert.deepEqual(report.consoleErrors, []);
          assert.deepEqual(report.httpErrors, []);
          assert.deepEqual(report.externalRequests, []);
        });
      } catch (error) { report.errorstatus ||= { name: error.name, message: error.message, stack: error.stack }; }
      try { await b.close(); } catch (error) { report.errorstatus ||= { name: error.name, message: error.message, stack: error.stack }; }
    }
    report.status = report.errorstatus ? 'failed' : 'passed';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length, screenshots: report.screenshots.length, report: reportPath, errorstatus: report.errorstatus }, null, 2));
    if (report.errorstatus) process.exitCode = 1;
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
