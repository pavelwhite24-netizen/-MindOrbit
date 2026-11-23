(function () {
  'use strict';
  const M = window.MindOrbit, KEY = 'mindorbit:data';
  const fresh = () => ({ schemaVersion: 1, revision: 0, updatedAt: null, settings: { sound: false, reducedMotion: 'system' }, streak: { lastLocalDay: null, current: 0, longest: 0, totalDays: 0 }, games: {} });
  const localDay = date => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  const dayNumber = day => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('日期格式不合法');
    const [y,m,d] = day.split('-').map(Number), date = new Date(Date.UTC(y,m-1,d));
    if (date.toISOString().slice(0,10) !== day) throw new Error('日期不合法');
    return date.getTime() / 86400000;
  };
  const advanceStreak = (previous, day) => {
    const next = { ...previous };
    const difference = previous.lastLocalDay === null ? null : dayNumber(day) - dayNumber(previous.lastLocalDay);
    if (difference === null || difference > 0) {
      next.current = difference === 1 ? previous.current + 1 : 1;
      next.longest = Math.max(next.longest, next.current); next.totalDays++; next.lastLocalDay = day;
    }
    return { streak: next, rollback: difference !== null && difference < 0 };
  };
  const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const validFavorites = value => Array.isArray(value) && value.length <= 18 && new Set(value).size === value.length && value.every(id => typeof id === 'string' && Object.prototype.hasOwnProperty.call(M.catalog,id));
  const finiteTree = (value, depth = 0) => {
    if (depth > 12) return false;
    if (value === null || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return value.length <= 12000;
    if (Array.isArray(value)) return value.length <= 1000 && value.every(item => finiteTree(item, depth+1));
    return object(value) && Object.entries(value).every(([key,item]) => !['__proto__','prototype','constructor'].includes(key) && finiteTree(item,depth+1));
  };
  const validateMetrics = (id, metrics) => {
    if (!object(metrics) || !finiteTree(metrics)) return false;
    const count = (key, max) => integer(metrics[key],0,max);
    const ms = (value, max = 120000) => Number.isFinite(value) && value >= 0 && value <= max;
    const nullableMs = (value, max) => value === null || ms(value,max);
    const list = (value, min, max, check) => Array.isArray(value) && value.length >= min && value.length <= max && value.every(check);
    const text = value => typeof value === 'string' && value.length > 0;
    const trialId = value => text(value) || (typeof value === 'number' && Number.isFinite(value));
    const unique = values => new Set(values).size === values.length;
    const mean = (key, samples, max) => nullableMs(metrics[key],max) && (samples === 0) === (metrics[key] === null);
    const { trials } = metrics, denominator = M.scoring.denominators[id];
    if (denominator && (!count('correct',denominator) || !count('missed',denominator) || metrics.correct + metrics.missed > denominator)) return false;
    if (id !== 'A3' && id !== 'E2') {
      if (!list(trials,0,1000,object)) return false;
    } else if (trials !== undefined && !list(trials,0,1000,object)) return false;
    const correctCount = () => trials.filter(t => t.correct === true).length;
    const choiceTrial = (trial, maxAnswer, maxMs, nullMissing = false) =>
      typeof trial.correct === 'boolean' && (trial.answer === null || integer(trial.answer,0,maxAnswer)) &&
      nullableMs(trial.rtMs,maxMs) && (trial.answer === null ? !trial.correct && (!nullMissing || trial.rtMs === null) : trial.rtMs !== null);
    const choiceCounts = () => metrics.correct === correctCount() && metrics.missed === denominator - trials.filter(t => t.answer !== null).length;
    if (id === 'A1' || id === 'A2') {
      const matrix = id === 'A1', max = matrix ? 8 : 9, errors = matrix ? 3 : 2;
      const best = matrix ? metrics.maxCorrectCells : metrics.maxLength;
      if (!integer(best,0,max) || (best > 0 && best < 3) || !count('errors',errors) || trials.length > max - 2 + errors) return false;
      if (!trials.every(t => typeof t.correct === 'boolean' && ['correct','incorrect','timeout'].includes(t.outcome) &&
          t.correct === (t.outcome === 'correct') && nullableMs(t.rtMs,matrix ? 8000 : 6000) && (t.outcome === 'timeout' || t.rtMs !== null))) return false;
      if (matrix) {
        if (!count('correctRounds',6) || !count('livesRemaining',3) || metrics.livesRemaining + metrics.errors !== 3 || metrics.correctRounds !== correctCount()) return false;
        if (!trials.every(t => integer(t.count,3,8) && list(t.cells,t.count,t.count,n => integer(n,0,15)) && unique(t.cells) &&
            list(t.selected,0,t.count,n => integer(n,0,15)) && unique(t.selected) && (!t.correct || t.selected.length === t.count))) return false;
      } else if (!trials.every(t => integer(t.length,3,9) && typeof t.sequence === 'string' && /^\d+$/.test(t.sequence) && t.sequence.length === t.length &&
          (t.answer === null ? t.rtMs === null : typeof t.answer === 'string' && /^\d*$/.test(t.answer) && t.answer.length <= t.length && t.rtMs !== null) &&
          (!t.correct || (t.answer !== null && t.answer.length === t.length)))) return false;
      return metrics.errors === trials.length - correctCount() && correctCount() === (best === 0 ? 0 : best - 2) &&
        best === Math.max(0,...trials.filter(t => t.correct).map(t => matrix ? t.count : t.length));
    }
    if (id === 'A3') {
      const layout = metrics.layout;
      return count('matchedPairs',8) && count('moves',100000) && metrics.moves >= metrics.matchedPairs && ms(metrics.durationMs) &&
        list(layout,16,16,text) && new Set(layout).size === 8 && layout.every(value => layout.filter(item => item === value).length === 2);
    }
    if (id === 'D1') {
      const samples = metrics.reactionTimes, validRt = rt => ms(rt,1500) && rt >= 100 && rt < 1500;
      if (!list(samples,0,5,validRt) || !count('penalties',10) || !count('attempts',10) || samples.length + metrics.penalties !== metrics.attempts || trials.length !== metrics.attempts) return false;
      if (!trials.every(t => integer(t.attempt,1,10) && integer(t.waitMs,2000,4000) && nullableMs(t.signalDelayMs) &&
          ['valid','early','false-start','missed'].includes(t.outcome) &&
          (t.outcome === 'valid' ? validRt(t.rtMs) && t.signalDelayMs !== null : t.outcome === 'early' ? ms(t.rtMs,100) && t.rtMs < 100 && t.signalDelayMs !== null : t.rtMs === null))) return false;
      const validTrials = trials.filter(t => t.outcome === 'valid');
      if (validTrials.length !== samples.length || !validTrials.every((t,i) => t.rtMs === samples[i])) return false;
      // Match the production arithmetic without depending on UI (loaded later).
      const sorted = samples.slice().sort((a,b) => a-b), middle = Math.floor(samples.length / 2);
      const expectedMean = samples.length ? samples.reduce((sum,rt) => sum + rt,0) / samples.length : null;
      const expectedMedian = samples.length ? samples.length % 2 ? sorted[middle] : (sorted[middle-1] + sorted[middle]) / 2 : null;
      return metrics.meanRtMs === expectedMean && metrics.medianRtMs === expectedMedian;
    }
    if (id === 'D3') {
      if (!count('hits',15) || !count('misses',15) || metrics.hits + metrics.misses !== 15 || !count('errors',100000) || !mean('meanHitMs',metrics.hits,1500) ||
          !list(metrics.targets,15,15,n => integer(n,0,8)) || trials.length !== 15) return false;
      return trials.every(t => integer(t.index,0,14) && integer(t.target,0,8) && ms(t.scheduledMs,28000) && nullableMs(t.shownMs) &&
          integer(t.errors,0,100000) && ['hit','missed'].includes(t.outcome) &&
          (t.outcome === 'hit' ? ms(t.rtMs,1500) && t.rtMs < 1500 && t.shownMs !== null : t.rtMs === null)) &&
        metrics.hits === trials.filter(t => t.outcome === 'hit').length && metrics.errors === trials.reduce((sum,t) => sum + t.errors,0);
    }
    if (id === 'E1') {
      if (!count('matchCorrect',8) || !count('nonmatchCorrect',15) || metrics.correct !== metrics.matchCorrect + metrics.nonmatchCorrect ||
          !list(metrics.sequence,25,25,n => integer(n,0,9)) || trials.length !== 25) return false;
      if (!trials.every((t,i) => integer(t.position,1,25) && integer(t.stimulus,0,9) && nullableMs(t.presentedAtMs) && nullableMs(t.rtMs,2000) &&
          (i < 2 ? t.warmup === true && t.expected === null && t.answer === null && t.correct === null && t.rtMs === null :
            t.warmup === false && typeof t.expected === 'boolean' && typeof t.correct === 'boolean' &&
            (t.answer === null ? !t.correct && t.rtMs === null : typeof t.answer === 'boolean' && t.rtMs !== null)))) return false;
      const scored = trials.slice(2);
      return metrics.correct === correctCount() && metrics.missed === scored.filter(t => t.answer === null).length &&
        metrics.matchCorrect === scored.filter(t => t.expected && t.correct).length && metrics.nonmatchCorrect === scored.filter(t => !t.expected && t.correct).length;
    }
    if (id === 'E2') return typeof metrics.completed === 'boolean' && count('progress',25) && count('errors',100000) &&
      metrics.completed === (metrics.progress === 25) && ms(metrics.durationMs) && list(metrics.layout,25,25,n => integer(n,1,25)) && unique(metrics.layout);
    if (id === 'E3') return count('correct',6) && mean('meanCorrectMs',metrics.correct,15000) && trials.length === 6 && trials.every(t =>
      trialId(t.id) && integer(t.columns,3,5) && integer(t.rows,3,6) && text(t.regular) && text(t.target) &&
      list(t.symbols,t.columns * t.rows,t.columns * t.rows,text) && integer(t.targetIndex,0,t.symbols.length-1) &&
      choiceTrial(t,t.symbols.length-1,15000,true)) && metrics.correct === correctCount();
    if (id === 'F2') return trials.length === 5 && trials.every(t => trialId(t.id) && list(t.sequence,3,7,n => integer(n,1,9)) &&
      integer(t.total,3,63) && list(t.options,4,4,n => integer(n,3,63)) && unique(t.options) && choiceTrial(t,3,7000,true)) && choiceCounts();
    const quizLimits = { B1:6000, B2:8000, B3:10000, C1:12000, C2:12000, C3:12000, D2:3000, F1:5000, F3:12000 };
    if (!Object.prototype.hasOwnProperty.call(quizLimits,id)) return false;
    const limit = quizLimits[id], maxAnswer = id === 'B1' || id === 'F3' ? 1 : id === 'C3' ? 2 : 3;
    // Shared quizzes record only settled trials; unpresented questions count as missed.
    return trials.length <= denominator && mean('meanCorrectMs',metrics.correct,limit) && trials.every(t => trialId(t.id) &&
      choiceTrial(t,maxAnswer,limit) && typeof t.explanation === 'string' && (text(t.stimulus) || object(t.stimulus))) && choiceCounts();
  };
  const validIso = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const validRecord = (record, id) => {
    if (!Object.prototype.hasOwnProperty.call(M.catalog,id) || !object(record) || record.gameId !== id || typeof record.sessionId !== 'string' || !record.sessionId || typeof record.rulesVersion !== 'string' || !/^[\w.-]{1,30}$/.test(record.rulesVersion) || typeof record.contentVersion !== 'string') return false;
    if (!['completed','lives_exhausted','timeout','attempts_exhausted'].includes(record.outcome) || !integer(record.score,0,100) || !validIso(record.completedAt) || !['pointer','keyboard','mixed'].includes(record.inputMode) || !integer(record.utcOffsetMinutes,-840,840) || !Number.isFinite(record.durationMs) || record.durationMs < 0 || record.durationMs > 120000 || !['string','number'].includes(typeof record.rngSeed)) return false;
    try { dayNumber(record.localDay); } catch { return false; }
    if (record.rulesVersion === '1') {
      if (!validateMetrics(id, record.metrics)) return false;
      try { if (record.score !== M.scoring.game(id,record.metrics)) return false; } catch { return false; }
    } else if (!object(record.metrics) || !finiteTree(record.metrics)) return false;
    return true;
  };
  const validate = data => {
    if (!object(data) || data.schemaVersion !== 1 || !integer(data.revision) || !(data.updatedAt === null || validIso(data.updatedAt)) || !object(data.settings) || typeof data.settings.sound !== 'boolean' || !['system','on','off'].includes(data.settings.reducedMotion) || !object(data.streak) || !object(data.games)) return false;
    if (data.settings.favorites !== undefined && !validFavorites(data.settings.favorites)) return false;
    const s = data.streak;
    if (!integer(s.current) || !integer(s.longest) || !integer(s.totalDays) || s.longest < s.current || s.totalDays < s.longest) return false;
    try { if (s.lastLocalDay !== null) dayNumber(s.lastLocalDay); else if (s.totalDays !== 0) return false; } catch { return false; }
    const ids = new Set();
    return Object.entries(data.games).every(([id, state]) => {
      if (!M.catalog[id] || !object(state) || !object(state.statsByRulesVersion) || !Array.isArray(state.history) || state.history.length > 100) return false;
      if (!Object.entries(state.statsByRulesVersion).every(([version,stats]) => /^[\w.-]{1,30}$/.test(version) && !['constructor','prototype','__proto__'].includes(version) && object(stats) && integer(stats.completedCount,1) && integer(stats.bestScore,0,100) && typeof stats.bestSessionId === 'string' && validIso(stats.lastCompletedAt))) return false;
      return state.history.every(record => {
        if (!validRecord(record,id) || ids.has(record.sessionId)) return false;
        ids.add(record.sessionId);
        const stats = state.statsByRulesVersion[record.rulesVersion];
        return stats && stats.bestScore >= record.score && stats.completedCount >= state.history.filter(item => item.rulesVersion === record.rulesVersion).length;
      });
    });
  };
  const create = backend => {
    let data = fresh(), persistent = true, reason = '', baseline = null, raw = null;
    const submitted = new Set();
    const fail = message => { persistent = false; reason = message; };
    try {
      const probe = KEY + ':probe:' + M.uid(); backend.setItem(probe,'1');
      if (backend.getItem(probe) !== '1') throw new Error();
      backend.removeItem(probe); baseline = backend.getItem(KEY); raw = baseline;
      if (baseline !== null) {
        const parsed = JSON.parse(baseline);
        if (!validate(parsed)) throw new Error('invalid');
        data = parsed;
      }
    } catch { fail('本地存储不可用或已有数据无法读取。原始数据保持不变，本次仅保存在内存。'); }
    const flush = () => {
      if (!persistent) return false;
      try {
        if (backend.getItem(KEY) !== baseline) { fail('检测到其他页面更改了记录。为避免覆盖，本页仅保存在内存，请刷新后再训练。'); return false; }
        const serialized = JSON.stringify(data); backend.setItem(KEY,serialized); baseline = serialized; return true;
      } catch { fail('设备存储写入失败。原有记录未清空，本次结果仅保存在内存，刷新后可能丢失。'); return false; }
    };
    return {
      get data() { return data; }, get persistent() { return persistent; }, get reason() { return reason; }, get raw() { return raw; },
      checkConflict() { if (persistent) { try { if (backend.getItem(KEY) !== baseline) fail('其他页面已更新记录，本页仅内存保存。请刷新后再训练。'); } catch { fail('本地存储不可用，本次仅内存保存。'); } } },
      externalChange() { fail('其他页面已更新或清空记录。本页停止写入，结果仅存内存，请刷新。'); },
      save(record) {
        if (!validRecord(record,record.gameId)) throw new Error('游戏结果校验失败');
        const previousGame = data.games[record.gameId];
        if (submitted.has(record.sessionId) || previousGame?.history.some(item => item.sessionId === record.sessionId)) return { duplicate: true, saved: persistent };
        const next = JSON.parse(JSON.stringify(data));
        const game = next.games[record.gameId] ||= { statsByRulesVersion: {}, history: [] };
        const previous = game.statsByRulesVersion[record.rulesVersion];
        const recordType = !previous ? 'first' : record.score > previous.bestScore ? 'new' : record.score === previous.bestScore ? 'equal' : 'none';
        game.statsByRulesVersion[record.rulesVersion] = {
          completedCount: (previous?.completedCount || 0) + 1,
          bestScore: Math.max(previous?.bestScore ?? 0,record.score),
          bestSessionId: !previous || record.score > previous.bestScore ? record.sessionId : previous.bestSessionId,
          lastCompletedAt: record.completedAt
        };
        game.history.push(record); game.history = game.history.slice(-100);
        const result = advanceStreak(next.streak,record.localDay); next.streak = result.streak;
        next.revision++; next.updatedAt = record.completedAt; data = next; submitted.add(record.sessionId);
        return { saved: flush(), recordType, rollback: result.rollback, best: game.statsByRulesVersion[record.rulesVersion].bestScore };
      },
      settings(patch) {
        if (patch.sound !== undefined && typeof patch.sound !== 'boolean') throw new Error('设置无效');
        if (patch.reducedMotion !== undefined && !['on','off','system'].includes(patch.reducedMotion)) throw new Error('设置无效');
        if (patch.favorites !== undefined && !validFavorites(patch.favorites)) throw new Error('设置无效');
        data.settings = { ...data.settings,...patch, ...(patch.favorites ? { favorites: patch.favorites.slice() } : {}) }; data.revision++; data.updatedAt = new Date().toISOString(); return flush();
      },
      reset() {
        try { backend.removeItem(KEY); data = fresh(); baseline = null; raw = null; persistent = true; reason = ''; submitted.clear(); return flush(); }
        catch { data = fresh(); submitted.clear(); fail('无法清除设备数据；当前内存已重置，请检查浏览器存储设置。'); return false; }
      }
    };
  };
  M.storage = { KEY, fresh, localDay, dayNumber, advanceStreak, validate, validateMetrics, validRecord, create };
})();
