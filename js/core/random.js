(function () {
  'use strict';
  const M = window.MindOrbit = { games: {}, data: {} };
  M.random = function (seed) {
    let state = 2166136261;
    for (const character of String(seed)) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
    const float = () => {
      state |= 0; state = state + 0x6D2B79F5 | 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
    const int = (min, max) => min + Math.floor(float() * (max - min + 1));
    const shuffle = array => {
      const copy = [...array];
      for (let i = copy.length - 1; i > 0; i--) { const j = int(0, i); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      return copy;
    };
    return { float, int, shuffle, pick: array => array[int(0, array.length - 1)], sample: (array, n) => shuffle(array).slice(0, n) };
  };
  M.uid = () => Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
  M.registerGame = definition => {
    const metadata = M.catalog[definition.id];
    if (!metadata || M.games[definition.id]) throw new Error('游戏注册异常：' + definition.id);
    M.games[definition.id] = { ...metadata, ...definition, moduleId: definition.id[0], rulesVersion: '1', contentVersion: '1', score: metrics => M.scoring.game(definition.id, metrics) };
  };
})();
