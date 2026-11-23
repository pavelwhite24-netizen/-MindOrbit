(function () {
  'use strict';
  const M = window.MindOrbit;
  M.generators = M.generators || {};
  M.data = M.data || {};
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));

  // Finite parameter pools guarantee two distinct questions per template even
  // for a pathological random stream; no unbounded random retry loops.
  const numberPools = { arithmetic: [], geometric: [], growing: [], alternating: [] };
  for (let start = 1; start <= 20; start++) {
    for (let difference = 2; difference <= 9; difference++) numberPools.arithmetic.push({ start, difference });
    for (let p = 2; p <= 9; p++) for (let q = 2; q <= 9; q++) if (p !== q) numberPools.alternating.push({ start, p, q });
  }
  for (let start = 1; start <= 5; start++) for (const ratio of [2,3]) numberPools.geometric.push({ start, ratio });
  for (let start = 1; start <= 10; start++) for (let firstDifference = 1; firstDifference <= 5; firstDifference++) for (let increment = 1; increment <= 3; increment++) numberPools.growing.push({ start, firstDifference, increment });
  M.data.C1 = { parameterPools: numberPools, minValue: 0, maxValue: 2000, limitMs: 12000 };

  function numberTerms(type, p) {
    const terms = [p.start], count = type === 'alternating' ? 7 : 6;
    for (let i = 1; i < count; i++) {
      const last = terms[i-1];
      if (type === 'arithmetic') terms.push(last + p.difference);
      else if (type === 'geometric') terms.push(last * p.ratio);
      else if (type === 'growing') terms.push(last + p.firstDifference + (i-1)*p.increment);
      else if (type === 'alternating') terms.push(last + (i % 2 ? p.p : p.q));
      else fail('未知数列模板。');
    }
    return terms;
  }
  function numberExplanation(type, p, sequence, solution) {
    if (type === 'arithmetic') return '预设等差规律：每次加 ' + p.difference + '，所以 ' + sequence[4] + ' + ' + p.difference + ' = ' + solution + '。';
    if (type === 'geometric') return '预设等比规律：每次乘 ' + p.ratio + '，所以 ' + sequence[4] + ' × ' + p.ratio + ' = ' + solution + '。';
    if (type === 'growing') {
      const differences = Array.from({ length: 5 }, (_, i) => p.firstDifference+i*p.increment);
      return '预设差值递增规律：相邻差值为 ' + differences.slice(0,4).join('、') + '，每次增加 ' + p.increment + '；下一差值为 ' + differences[4] + '，下一项是 ' + solution + '。';
    }
    return '预设交替增量：依次加 ' + p.p + '、' + p.q + '，重复循环；最后一步加了 ' + p.p + '，下一步加 ' + p.q + '，得到 ' + solution + '。';
  }
  function numericOptions(rng, type, p, sequence, solution) {
    const last = sequence[sequence.length-1], previous = sequence[sequence.length-2], difference = last-previous;
    let candidates = [last, last+difference, last-difference, solution+difference, last+1];
    if (type === 'geometric') candidates = [last+p.ratio, last*(p.ratio-1), last*(p.ratio+1), last+(last-previous)].concat(candidates);
    if (type === 'growing') candidates = [last+difference, last+difference+2*p.increment, last+p.firstDifference].concat(candidates);
    if (type === 'alternating') candidates = [last+p.p, last+p.p+p.q, last-p.q].concat(candidates);
    const wrong = [...new Set(candidates)].filter(n => Number.isInteger(n) && n >= 0 && n <= 2000 && n !== solution);
    for (let delta = 1; wrong.length < 3; delta++) for (const n of [solution-delta, solution+delta]) {
      if (n >= 0 && n <= 2000 && n !== solution && !wrong.includes(n)) wrong.push(n);
    }
    return rng.shuffle([solution].concat(rng.sample(wrong, 3)));
  }
  function C1(rng) {
    const questions = Object.entries(numberPools).flatMap(([type, pool]) => rng.sample(pool, 2).map(parameters => {
      const p = clone(parameters), terms = numberTerms(type, p), solution = terms.pop(), sequence = terms;
      if (terms.concat(solution).some(n => !Number.isInteger(n) || n < 0 || n > 2000)) fail('数列项超出范围。');
      const options = numericOptions(rng, type, p, sequence, solution), id = 'series-' + type + '-' + Object.values(p).join('-');
      return { id, prompt: '按预设规律，下一项是什么？\n' + sequence.join('，') + '，？', options, answer: options.indexOf(solution), limitMs: 12000,
        explanation: numberExplanation(type, p, sequence, solution),
        record: { template: type, parameters: p, sequence, solution, options: options.slice() } };
    }));
    return rng.shuffle(questions);
  }
  Object.assign(C1, { terms: numberTerms });

  const attributes = ['direction','count','filled'];
  const stateKey = state => [state.direction, state.count, Number(state.filled)].join(':');
  function stepState(initial, changing, steps, directionStep) {
    return {
      direction: changing.includes('direction') ? (initial.direction + steps*directionStep % 4 + 4) % 4 : initial.direction,
      count: changing.includes('count') ? (initial.count-1+steps) % 3 + 1 : initial.count,
      filled: changing.includes('filled') && steps % 2 ? !initial.filled : initial.filled
    };
  }
  function patternOptions(rng, initial, changing, directionStep) {
    const solution = stepState(initial, changing, 4, directionStep), last = stepState(initial, changing, 3, directionStep);
    const candidates = [{ state: last, reason: '未变化：重复上一项' }];
    if (changing.length === 2) changing.forEach(attribute => candidates.push({ state: stepState(last, [attribute], 1, directionStep), reason: '只改变' + attribute + '，漏掉另一属性' }));
    if (changing.includes('direction')) candidates.push({ state: stepState(last, changing, 1, -directionStep), reason: '方向反转：向相反方向转 90°' });
    if (changing.includes('count')) {
      const state = { ...solution, count: (last.count+1) % 3 + 1 };
      candidates.push({ state, reason: '数量沿相反次序变化' });
    }
    // A period-two property has only one wrong value. Its other distractors
    // deliberately alter an attribute that the displayed rule keeps constant.
    attributes.forEach(attribute => {
      const state = { ...solution };
      if (attribute === 'direction') state.direction = (state.direction+1) % 4;
      if (attribute === 'count') state.count = state.count % 3+1;
      if (attribute === 'filled') state.filled = !state.filled;
      candidates.push({ state, reason: changing.includes(attribute) ? '错误改变' + attribute : '错误改变应保持不变的' + attribute });
    });
    const seen = new Set([stateKey(solution)]), wrong = candidates.filter(candidate => {
      const key = stateKey(candidate.state);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 3);
    if (wrong.length !== 3) fail('图形规律缺少不同的干扰项。');
    return rng.shuffle([{ state: solution, reason: '按全部预设属性变化' }].concat(wrong));
  }
  function C2(rng) {
    const singles = rng.shuffle([['direction'],['count'],['filled'],[rng.pick(attributes)]]);
    const pairs = [['direction','count'],['direction','filled'],['count','filled']];
    const doubles = rng.shuffle(pairs.concat([rng.pick(pairs)]));
    const used = new Set();
    return singles.concat(doubles).map(changing => {
      // Select without replacement from all 24 initial visible states.
      const initials = [];
      for (let direction = 0; direction < 4; direction++) for (let count = 1; count <= 3; count++) for (const filled of [false,true]) initials.push({ direction, count, filled });
      const directionStep = 1; // Consistent clockwise 90-degree rule.
      const eligible = initials.filter(initial => !used.has(changing.join('+') + ':' + stateKey(initial)));
      const initial = rng.pick(eligible), id = 'pattern-' + changing.join('+') + '-' + stateKey(initial);
      used.add(changing.join('+') + ':' + stateKey(initial));
      const sequence = [0,1,2,3].map(i => stepState(initial, changing, i, directionStep));
      const solution = stepState(initial, changing, 4, directionStep), optionRecords = patternOptions(rng, initial, changing, directionStep), options = optionRecords.map(o => o.state);
      const explanations = {
        direction: changing.includes('direction') ? '方向每次顺时针旋转 90°' : '方向保持不变',
        count: changing.includes('count') ? '数量按 1→2→3→1 循环' : '数量保持为 ' + initial.count,
        filled: changing.includes('filled') ? '实心与空心交替' : '填充保持' + (initial.filled ? '实心' : '空心')
      };
      return { id, prompt: '观察四项序列，选择下一项。', options, answer: options.findIndex(state => stateKey(state) === stateKey(solution)), limitMs: 12000,
        explanation: attributes.map(a => explanations[a]).join('；') + '。下一项：' + ['向右','向下','向左','向上'][solution.direction] + '、' + solution.count + ' 个、' + (solution.filled ? '实心' : '空心') + '。',
        record: { changing: changing.slice(), initial: { ...initial }, periods: { ...M.data.C2.periods }, steps: { direction: changing.includes('direction') ? directionStep : 0, count: changing.includes('count') ? 1 : 0, filled: changing.includes('filled') ? 1 : 0 }, sequence, options: clone(options), distractors: optionRecords.map(o => o.reason) } };
    });
  }
  function renderPattern(state) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 128 64'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('class', 'reasoning-svg pattern-shape');
    svg.style.width = '100%'; svg.style.maxWidth = '192px'; svg.style.height = 'auto'; svg.style.display = 'block'; svg.style.margin = '0 auto';
    const d = M.data.C2.motif.map(([x,y], index) => (index ? 'L' : 'M') + x + ' ' + y).join(' ') + ' Z';
    for (let i = 0; i < state.count; i++) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      // Fixed spacing and primitive size; the group is simply centred.
      path.setAttribute('transform', 'translate(' + (64+(i-(state.count-1)/2)*38) + ' 32) rotate(' + state.direction*90 + ')');
      path.setAttribute('fill', state.filled ? 'currentColor' : 'none'); path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round'); svg.append(path);
    }
    return svg;
  }
  Object.assign(C2, { stateKey, stepState, renderPattern });

  const people = ['A','B','C'];
  function enumerate(statements) {
    if (!Array.isArray(statements) || statements.length !== 3 || statements.some(s => !['is','isnot'].includes(s.op) || !people.includes(s.person))) fail('真假推理只允许“是/不是 A、B、C”三条陈述。');
    return people.map(target => {
      const truth = statements.map(statement => statement.op === 'is' ? target === statement.person : target !== statement.person);
      return { target, truth, trueCount: truth.filter(Boolean).length, truthSpeaker: truth.filter(Boolean).length === 1 ? people[truth.indexOf(true)] : null };
    });
  }
  function validateTruth(item) {
    const models = enumerate(item.statements), valid = models.filter(model => model.trueCount === 1);
    return valid.length === 1 && valid[0].target === item.target && valid[0].truthSpeaker === item.truthSpeaker;
  }
  function C3(rng) {
    const pool = M.data.C3;
    if (!pool || pool.length < 24 || new Set(pool.map(q => JSON.stringify(q.statements))).size !== pool.length || new Set(pool.map(q => q.id)).size !== pool.length || pool.some(q => !validateTruth(q))) fail('真假推理题库不足、重复或没有唯一模型。');
    return rng.sample(pool, 8).map(item => {
      const models = enumerate(item.statements), options = rng.shuffle(people);
      const explanation = models.map(model => '若获奖者是 ' + model.target + '，A/B/C 的话依次为' + model.truth.map(value => value ? '真' : '假').join('、') + '（' + model.trueCount + ' 句真话）').join('；') + '。只有获奖者为 ' + item.target + ' 符合恰好一真，因此说真话的是 ' + item.truthSpeaker + '（题目问说话者，不是获奖者）。';
      return { id: item.id, prompt: '获奖者恰为 A、B、C 中的一人，三人中恰好一人说真话。谁说真话？', options, answer: options.indexOf(item.truthSpeaker), explanation, limitMs: 12000,
        record: { statements: clone(item.statements), target: item.target, truthSpeaker: item.truthSpeaker, models, options: options.slice() } };
    });
  }
  Object.assign(C3, { enumerate, validateTruth });
  M.generators.C1 = C1; M.generators.C2 = C2; M.generators.C3 = C3;
  M.registerGame({ id: 'C1', createSession(ctx) { return M.ui.quiz(ctx, C1(ctx.rng), { limitMs: 12000 }); } });
  M.registerGame({ id: 'C2', createSession(ctx) {
    return M.ui.quiz(ctx, C2(ctx.rng), { limitMs: 12000, render(question, container) {
      container.append(M.ui.el('div', 'question-prompt', question.prompt));
      const sequence = M.ui.el('div', 'reasoning-sequence');
      // Two by two at narrow widths rather than four illegible tiny images.
      sequence.style.display = 'grid'; sequence.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))'; sequence.style.gap = '8px';
      question.record.sequence.forEach((state, index) => {
        const item = M.ui.el('div', 'reasoning-figure');
        item.append(M.ui.el('p', 'reasoning-caption', '第 ' + (index+1) + ' 项'), renderPattern(state)); sequence.append(item);
      });
      container.append(sequence);
    }, renderOption: renderPattern });
  } });
  M.registerGame({ id: 'C3', createSession(ctx) {
    return M.ui.quiz(ctx, C3(ctx.rng), { limitMs: 12000, render(question, container) {
      container.append(M.ui.el('div', 'question-prompt', question.prompt));
      const list = M.ui.el('ul', 'truth-statements');
      question.record.statements.forEach((statement, index) => list.append(M.ui.el('li', '', people[index] + ' 说：“获奖者' + (statement.op === 'is' ? '是 ' : '不是 ') + statement.person + '。”')));
      container.append(list);
    } });
  } });
})();
