(function () {
  'use strict';
  const M = window.MindOrbit;
  M.createHost = (game, elements, handlers) => {
    let state = 'idle', session, startedAt = null, deadline = Infinity, questionDeadline = Infinity, stage = 'preparing';
    const timers = new Set(), frames = new Set(), removers = [], inputModes = new Set();
    const sessionId = M.uid(), seed = M.uid(), rng = M.random(seed);
    const now = () => performance.now();
    const elapsed = () => startedAt === null ? 0 : Math.min(120000, Math.max(0, now() - startedAt));
    const cleanup = () => {
      timers.forEach(id => clearTimeout(id)); timers.clear(); frames.forEach(id => cancelAnimationFrame(id)); frames.clear();
      removers.splice(0).forEach(remove => remove());
      try { session?.destroy(); } catch (error) { console.error('游戏清理失败', error); }
    };
    const abort = message => {
      if (state === 'finished' || state === 'aborted') return;
      state = 'aborted'; cleanup(); handlers.onAbort(message);
    };
    const technicalError = error => { console.error('训练已因异常中止', error); abort('本局发生技术异常，已中断且不计入成绩。请重开；若反复发生，请刷新页面。'); };
    const commit = (outcome, metrics) => {
      const durationMs = elapsed(), completed = new Date();
      const record = { sessionId, gameId: game.id, rulesVersion: game.rulesVersion, contentVersion: game.contentVersion, outcome, score: game.score(metrics,outcome), metrics, completedAt: completed.toISOString(), localDay: M.storage.localDay(completed), utcOffsetMinutes: -completed.getTimezoneOffset(), durationMs, inputMode: inputModes.size > 1 ? 'mixed' : [...inputModes][0] || 'pointer', rngSeed: seed };
      const saved = M.store.save(record);
      state = 'finished'; cleanup(); handlers.onFinish(record,saved);
    };
    const timeout = () => {
      if (state !== 'running') return;
      state = 'settling';
      try { const metrics = session.onTimeout(); commit('timeout',metrics); } catch (error) { technicalError(error); }
    };
    const guard = fn => (...args) => {
      if (state !== 'running') return;
      if (now() >= deadline) { timeout(); return; }
      try { fn(...args); } catch (error) { technicalError(error); }
    };
    const later = (fn, delay, duringPreparation = false) => {
      const id = setTimeout(() => {
        timers.delete(id);
        if (duringPreparation) { if (state === 'preparing') { try { fn(); } catch (error) { technicalError(error); } } }
        else guard(fn)();
      }, Math.max(0,delay));
      timers.add(id); return id;
    };
    const context = {
      container: elements.container, sessionId, rng, now, elapsed,
      get sessionDeadline() { return deadline; },
      schedule: (fn,delay) => later(fn,delay),
      cancel(id) { clearTimeout(id); timers.delete(id); },
      frame(fn) { const id = requestAnimationFrame(timestamp => { frames.delete(id); guard(fn)(timestamp); }); frames.add(id); return id; },
      listen(target,type,fn) {
        const wrapped = guard(event => {
          if (event.repeat) { event.preventDefault(); return; }
          if (event.type.startsWith('key')) inputModes.add('keyboard');
          else if (event.type.startsWith('pointer')) inputModes.add('pointer');
          else if (event.type === 'click' && event.detail === 0) inputModes.add('keyboard');
          fn(event);
        });
        target.addEventListener(type,wrapped); removers.push(() => target.removeEventListener(type,wrapped)); return wrapped;
      },
      finish(outcome,metrics) {
        if (state !== 'running') return;
        if (now() >= deadline) { timeout(); return; }
        state = 'settling'; try { commit(outcome,metrics); } catch (error) { technicalError(error); }
      },
      abort,
      setStatus(text) { elements.status.textContent = text; },
      setProgress(current,total) {
        elements.progress.textContent = `${current} / ${total}`;
        elements.bar.style.width = `${Math.max(0,Math.min(100,100 * current / total))}%`;
      },
      setStage(value) { stage = value; elements.container.dataset.stage = value; },
      setRemaining(value) { questionDeadline = value; }
    };
    const tick = () => {
      const remaining = Math.max(0, Math.min(questionDeadline,deadline) - now());
      elements.timer.textContent = `${(remaining / 1000).toFixed(1)}s`;
      elements.timer.classList.toggle('urgent',remaining < 3000);
      elements.total.textContent = `${Math.ceil((deadline - now()) / 1000)}s`;
      later(tick,100);
    };
    const hidden = () => { if (document.hidden && ['running','preparing'].includes(state)) abort('本局因切换页面已中断，不计入成绩。回来后可重新开始。'); };
    return {
      get state() { return state; }, get active() { return ['preparing','running'].includes(state); }, get stage() { return stage; },
      abort,
      startPreparing() {
        if (state !== 'idle') return;
        M.store.checkConflict(); state = 'preparing';
        document.addEventListener('visibilitychange',hidden); removers.push(() => document.removeEventListener('visibilitychange',hidden));
        try {
          session = game.createSession(context);
          if (!session || !['start','onTimeout','destroy'].every(key => typeof session[key] === 'function')) throw new Error('游戏接口不完整');
          let count = 3;
          const show = () => {
            elements.container.replaceChildren(M.ui.el('div','countdown-number',count),M.ui.el('p','muted','放松一下，准备开始'));
            if (count-- > 0) later(show,1000,true);
            else {
              elements.container.replaceChildren(); startedAt = now(); deadline = startedAt + 120000; questionDeadline = deadline; state = 'running';
              later(timeout,120000); session.start(); if (state === 'running') tick();
            }
          };
          show();
        } catch (error) { technicalError(error); }
      }
    };
  };
})();
