(function () {
  'use strict';
  const M = window.MindOrbit;
  const clip = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const normalize = x => {
    if (!Number.isFinite(x)) throw new TypeError('得分必须为有限数字');
    return Math.round(clip(x, 0, 100) + 1e-9);
  };
  const speed = (time, low, high) => {
    if (!Number.isFinite(time) || !(low < high)) throw new TypeError('无效计时指标');
    return clip((high - time) / (high - low), 0, 1);
  };
  const denominators = { B1:10, B2:8, B3:8, C1:8, C2:8, C3:8, D2:12, E1:23, F1:10, F2:5, F3:8 };
  const game = (id, m) => {
    if (denominators[id]) return normalize(100 * m.correct / denominators[id]);
    switch (id) {
      case 'A1': return m.maxCorrectCells === 0 ? 0 : normalize(100 * (m.maxCorrectCells - 2) / 6);
      case 'A2': return m.maxLength === 0 ? 0 : normalize(100 * (m.maxLength - 2) / 7);
      case 'A3': return normalize(100 * m.matchedPairs / 8 * (0.7 * m.matchedPairs / Math.max(m.moves, 1) + 0.3 * speed(m.durationMs / 1000, 30, 120)));
      case 'D1': return m.reactionTimes.length === 0 ? 0 : normalize(100 * m.reactionTimes.length / 5 * speed(m.meanRtMs, 200, 700) - 5 * m.penalties);
      case 'D3': return normalize(100 * m.hits / 15 - 2 * m.errors);
      case 'E2': return !m.completed ? 0 : normalize(100 * speed(m.durationMs / 1000 + 2 * m.errors, 25, 120));
      case 'E3': return m.correct === 0 ? 0 : normalize(100 * m.correct / 6 * (0.7 + 0.3 * speed(m.meanCorrectMs / 1000, 2, 12)));
      default: throw new Error('未知游戏');
    }
  };
  const ranks = [ [0,'星尘'], [20,'卫星'], [35,'行星'], [50,'恒星'], [65,'星云'], [80,'星系'], [90,'黑洞'] ];
  const rank = value => value === null ? null : [...ranks].reverse().find(([threshold]) => value >= threshold)[1];
  const average = values => values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  const portrait = data => {
    const games = {};
    for (const [id, definition] of Object.entries(M.games)) {
      const history = (data.games[id]?.history || []).filter(item => item.rulesVersion === definition.rulesVersion).slice(-5);
      games[id] = { score: average(history.map(item => item.score)), samples: history.length };
    }
    const modules = M.modules.map(module => {
      const values = Object.entries(games).filter(([id]) => id[0] === module.id).map(([,value]) => value.score).filter(score => score !== null);
      return { id: module.id, coverage: values.length, score: average(values), complete: values.length === 3 };
    });
    const coverage = Object.values(games).filter(value => value.score !== null).length;
    const score = coverage === 18 ? average(modules.map(module => module.score)) : null;
    return { games, modules, coverage, score, rank: rank(score) };
  };
  M.scoring = { clip, normalize, speed, game, rank, ranks, portrait, average, denominators };
})();
