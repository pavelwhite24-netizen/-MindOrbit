(function () {
  'use strict';
  const M = window.MindOrbit;
  M.generators = M.generators || {};
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };
  const svgNS = 'http://www.w3.org/2000/svg';
  function svgNode(tag, attributes) {
    const node = document.createElementNS(svgNS, tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    return node;
  }
  function canvas(className) {
    const node = svgNode('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true', focusable: 'false', class: 'reasoning-svg ' + className });
    node.style.width = '100%'; node.style.maxWidth = '180px'; node.style.height = 'auto';
    node.style.display = 'block'; node.style.margin = '0 auto';
    return node;
  }
  const normalize = cells => {
    const minX = Math.min(...cells.map(p => p[0])), minY = Math.min(...cells.map(p => p[1]));
    return cells.map(([x, y]) => [x - minX, y - minY]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  };
  const cellKey = cells => normalize(cells).map(p => p.join(',')).join(';');
  function rotate(cells, turns) {
    let result = normalize(cells);
    for (let i = 0; i < ((turns % 4) + 4) % 4; i++) result = normalize(result.map(([x, y]) => [-y, x]));
    return result;
  }
  const mirror = cells => normalize(cells.map(([x, y]) => [-x, y]));
  const rotationKey = cells => [0,1,2,3].map(turn => cellKey(rotate(cells, turn))).sort()[0];
  function validateShape(cells) {
    if (!Array.isArray(cells) || cells.length < 5 || cells.length > 7 || cells.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger))) return false;
    const keys = new Set(cells.map(p => p.join(',')));
    if (keys.size !== cells.length) return false;
    const visited = new Set(), pending = [cells[0]];
    while (pending.length) {
      const [x, y] = pending.pop(), key = x + ',' + y;
      if (!keys.has(key) || visited.has(key)) continue;
      visited.add(key);
      pending.push([x-1,y], [x+1,y], [x,y-1], [x,y+1]);
    }
    return visited.size === cells.length && new Set([0,1,2,3].map(t => cellKey(rotate(cells, t)))).size === 4 && rotationKey(cells) !== rotationKey(mirror(cells));
  }
  function renderCells(cells) {
    const svg = canvas('rotation-shape'), normalized = normalize(cells);
    const width = Math.max(...normalized.map(p => p[0])) + 1, height = Math.max(...normalized.map(p => p[1])) + 1;
    // Fixed 16-unit cell size on BOTH sides, even when width/height exchange.
    normalized.forEach(([x, y]) => svg.append(svgNode('rect', { x: (100-width*16)/2+x*16, y: (100-height*16)/2+y*16, width: 16, height: 16, fill: 'currentColor' })));
    return svg;
  }
  function B1(rng) {
    const pool = M.data.B1;
    if (!pool || pool.length < 10 || pool.some(shape => !validateShape(shape.cells)) || new Set(pool.map(shape => rotationKey(shape.cells))).size !== pool.length) fail('空间旋转题库不足或坐标校验失败。');
    const labels = rng.shuffle([true,true,true,true,true,false,false,false,false,false]);
    return rng.sample(pool, 10).map((shape, index) => {
      const left = rotate(shape.cells, rng.int(0, 3)), turns = rng.int(1, 3), same = labels[index];
      const right = rotate(same ? left : mirror(left), turns), options = rng.shuffle(['相同', '不同']);
      if ((rotationKey(left) === rotationKey(right)) !== same) fail('空间旋转变换校验失败。');
      return {
        id: shape.id, prompt: '右图能否仅通过平面旋转与左图重合？不能翻面。', options, answer: options.indexOf(same ? '相同' : '不同'), limitMs: 6000,
        explanation: same ? '相同：左图顺时针旋转 ' + turns*90 + '° 可与右图重合。' : '不同：右图是左图左右镜像后再顺时针旋转 ' + turns*90 + '°；单靠平面旋转不能重合。',
        record: { baseId: shape.id, left, right, turns, mirrored: !same, options: options.slice() }
      };
    });
  }
  Object.assign(B1, { normalize, rotate, mirror, rotationKey, validateShape, renderCells });

  const outlineById = id => M.data.B2.outlines.find(outline => outline.id === id);
  const pathData = points => points.map(([x, y], index) => (index ? 'L' : 'M') + x + ' ' + y).join(' ') + ' Z';
  function renderOutline(id, mask) {
    const outline = outlineById(id);
    if (!outline) fail('图形轮廓不存在。');
    const svg = canvas('completion-shape');
    const attrs = { d: pathData(outline.points), pathLength: 100, fill: 'none', stroke: 'currentColor', 'stroke-width': 3, 'stroke-linejoin': 'round', 'stroke-linecap': 'butt' };
    if (mask) { attrs['stroke-dasharray'] = mask.dash.join(' '); attrs['stroke-dashoffset'] = mask.offset; }
    svg.append(svgNode('path', attrs));
    return svg;
  }
  function contourSegments(points) {
    return points.map((a, i) => { const b = points[(i+1) % points.length]; return { a, b, length: Math.hypot(b[0]-a[0], b[1]-a[1]) }; });
  }
  function pointAt(points, percent) {
    const segments = contourSegments(points), total = segments.reduce((sum, segment) => sum + segment.length, 0);
    let distance = ((percent % 100) + 100) % 100 * total / 100;
    for (const segment of segments) {
      if (distance <= segment.length) {
        const t = distance / segment.length;
        return [segment.a[0] + (segment.b[0]-segment.a[0])*t, segment.a[1] + (segment.b[1]-segment.a[1])*t];
      }
      distance -= segment.length;
    }
    return points[0].slice();
  }
  function visibleAt(record, percent) {
    let position = ((percent + record.offset) % 100 + 100) % 100;
    for (let i = 0; i < record.dash.length; i++) {
      if (position < record.dash[i]) return i % 2 === 0;
      position -= record.dash[i];
    }
    return true;
  }
  function distanceToContour(point, points) {
    return Math.min(...contourSegments(points).map(({ a, b, length }) => {
      const t = Math.max(0, Math.min(1, ((point[0]-a[0])*(b[0]-a[0])+(point[1]-a[1])*(b[1]-a[1])) / (length*length)));
      return Math.hypot(point[0]-a[0]-t*(b[0]-a[0]), point[1]-a[1]-t*(b[1]-a[1]));
    }));
  }
  function auditMask(record) {
    const base = outlineById(record.baseId), visible = [];
    for (let p = 0.125; p < 100; p += 0.25) if (visibleAt(record, p)) visible.push(pointAt(base.points, p));
    return record.options.map(id => {
      const distances = visible.map(point => distanceToContour(point, outlineById(id).points));
      return { id, mismatchFraction: distances.filter(distance => distance > 3).length / visible.length, maxDistance: Math.max(...distances) };
    });
  }
  function validateMask(record) {
    const ranges = { low: [20,30], mid: [30,40], high: [40,50] }, range = ranges[record.level];
    if (!range || !Array.isArray(record.dash) || !record.dash.length || record.dash.length % 2 || record.dash.some(n => !Number.isFinite(n) || n <= 0) || record.dash.reduce((a,b) => a+b, 0) !== 100 || !Number.isFinite(record.offset)) return false;
    const hidden = record.dash.filter((_, i) => i % 2).reduce((a,b) => a+b, 0);
    if (hidden !== record.hiddenPercent || hidden < range[0] || hidden > range[1] || record.options.length !== 4 || new Set(record.options).size !== 4 || !record.options.includes(record.baseId) || record.options.some(id => !outlineById(id))) return false;
    return auditMask(record).every(result => result.id === record.baseId ? result.maxDistance < 1e-7 : result.mismatchFraction >= 0.15);
  }
  function B2(rng) {
    const data = M.data.B2;
    if (!data || data.outlines.length < 12 || data.records.length < 36 || new Set(data.outlines.map(o => o.id)).size !== data.outlines.length || new Set(data.records.map(r => r.id)).size !== data.records.length) fail('图形完形题库不足。');
    // Pick distinct bases FIRST: no probabilistic quota retries or duplicates.
    for (const outline of data.outlines) for (const level of ['low','mid','high']) {
      if (!data.records.some(record => record.baseId === outline.id && record.level === level)) fail('图形完形缺少固定难度版本。');
    }
    const bases = rng.sample(data.outlines, 8), levels = ['low','low','low','mid','mid','mid','high','high'];
    return bases.map((base, index) => {
      const record = clone(rng.pick(data.records.filter(r => r.baseId === base.id && r.level === levels[index])));
      if (!validateMask(record)) fail('图形完形遮挡比例或可见轮廓匹配校验失败。');
      const options = rng.shuffle(record.options);
      record.options = options.slice();
      return { id: record.id, prompt: '观察残缺轮廓，选择对应的完整图形。', options, answer: options.indexOf(base.id), limitMs: 8000,
        explanation: '答案为选项 ' + (options.indexOf(base.id)+1) + '（' + base.name + '）。' + base.feature + '；遮去的是 ' + record.hiddenPercent + '% 的轮廓长度。', record };
    });
  }
  Object.assign(B2, { renderOutline, pathData, pointAt, visibleAt, auditMask, validateMask });

  function B3(rng) {
    const types = ['category','purpose','wholePart','correspondence'], pool = M.data.B3;
    if (!pool || pool.length < 40 || new Set(pool.map(q => q.id)).size !== pool.length || new Set(pool.map(q => [q.a,q.b,q.c].join(':'))).size !== pool.length) fail('类比联想题库不足或重复。');
    const selected = types.flatMap(type => {
      const group = pool.filter(q => q.type === type);
      if (group.length < 10) fail('类比联想的关系类别题量不足。');
      return rng.sample(group, 2);
    });
    return rng.shuffle(selected).map(item => {
      if (item.options.length !== 4 || new Set(item.options).size !== 4 || item.options[item.answer] !== item.solution || !item.explanation) fail('类比联想选项校验失败。');
      const options = rng.shuffle(item.options);
      return { id: item.id, prompt: item.a + ' : ' + item.b + ' :: ' + item.c + ' : ？', options, answer: options.indexOf(item.solution), limitMs: 10000,
        explanation: item.relation + '：' + item.explanation,
        record: { id: item.id, type: item.type, a: item.a, b: item.b, c: item.c, relation: item.relation, options: options.slice() } };
    });
  }
  M.generators.B1 = B1; M.generators.B2 = B2; M.generators.B3 = B3;

  M.registerGame({ id: 'B1', createSession(ctx) {
    return M.ui.quiz(ctx, B1(ctx.rng), { limitMs: 6000, render(question, container) {
      container.append(M.ui.el('div', 'question-prompt', question.prompt));
      const pair = M.ui.el('div', 'reasoning-pair');
      pair.style.display = 'grid'; pair.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))'; pair.style.gap = '12px';
      [question.record.left, question.record.right].forEach((cells, index) => {
        const panel = M.ui.el('div', 'reasoning-figure');
        panel.append(M.ui.el('p', 'reasoning-caption', index ? '右图' : '左图'), renderCells(cells)); pair.append(panel);
      });
      container.append(pair);
    } });
  } });
  M.registerGame({ id: 'B2', createSession(ctx) {
    let current;
    // Keep the shared quiz's locking/timing/metrics. Only add a full-contour
    // reveal at its feedback transition (including a per-question timeout).
    const local = Object.create(ctx);
    local.setStage = stage => {
      ctx.setStage(stage);
      if (stage === 'feedback' && current) {
        const reveal = M.ui.el('div', 'completion-reveal');
        reveal.append(M.ui.el('p', 'reasoning-caption', '完整轮廓'), renderOutline(current.record.baseId));
        ctx.container.append(reveal);
      }
    };
    return M.ui.quiz(local, B2(ctx.rng), { limitMs: 8000, render(question, container) {
      current = question;
      container.append(M.ui.el('div', 'question-prompt', question.prompt), renderOutline(question.record.baseId, question.record));
    }, renderOption: id => renderOutline(id) });
  } });
  M.registerGame({ id: 'B3', createSession(ctx) { return M.ui.quiz(ctx, B3(ctx.rng), { limitMs: 10000 }); } });
})();
