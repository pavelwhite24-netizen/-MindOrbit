(function () {
  'use strict';
  const M = window.MindOrbit;
  const ui = M.ui;
  const generators = M.generators = M.generators || {};

  // The host owns resources; this local gate also makes destroy safe before host cleanup.
  function managedContext(ctx) {
    let open = true;
    const timers = new Set();
    const local = Object.create(ctx);
    const live = () => open && ctx.now() < ctx.sessionDeadline;
    const close = () => {
      if (!open) return;
      open = false;
      timers.forEach(id => ctx.cancel(id)); timers.clear();
    };
    local.schedule = (fn, delay) => {
      if (!live()) return undefined;
      const id = ctx.schedule(() => { timers.delete(id); if (live()) fn(); }, Math.max(0, delay));
      timers.add(id); return id;
    };
    local.cancel = id => { if (id !== undefined) { timers.delete(id); ctx.cancel(id); } };
    local.listen = (target, event, fn) => {
      // ctx.listen may return the wrapped callback, not an unsubscribe function.
      // The host removes listeners; the local gate makes them inert immediately.
      return ctx.listen(target, event, e => {
        if (!live() || target.isConnected === false) return;
        if (e.repeat) { e.preventDefault(); return; }
        fn(e);
      });
    };
    local.finish = (outcome, metrics) => { if (live()) { close(); ctx.finish(outcome, metrics); } };
    local.abort = message => { if (open) { close(); ctx.abort(message); } };
    return { ctx: local, close, live };
  }

  generators.E1 = function (rng) {
    const matches = new Set(rng.sample(Array.from({ length: 23 }, (_, i) => i + 2), 8));
    const sequence = [];
    for (let i = 0; i < 25; i++) {
      if (i < 2) sequence.push(rng.int(0, 9));
      else if (matches.has(i)) sequence.push(sequence[i - 2]);
      else sequence.push(rng.pick(Array.from({ length: 10 }, (_, n) => n).filter(n => n !== sequence[i - 2])));
    }
    return sequence;
  };

  generators.E2 = rng => rng.shuffle(Array.from({ length: 25 }, (_, i) => i + 1));

  generators.E3 = function (rng) {
    return [[3, 3], [3, 4], [4, 4], [4, 5], [5, 5], [5, 6]].map(([columns, rows], index) => {
      const [regular, target] = rng.pick([['↑', '↓'], ['↓', '↑'], ['←', '→'], ['→', '←']]);
      const targetIndex = rng.int(0, columns * rows - 1);
      return { id: 'E3-' + (index + 1), columns, rows, regular, target, targetIndex,
        symbols: Array.from({ length: columns * rows }, (_, i) => i === targetIndex ? target : regular) };
    });
  };

  M.registerGame({
    id: 'E1',
    createSession(host) {
      const sequence = generators.E1(host.rng);
      const resources = managedContext(host), ctx = resources.ctx;
      const trials = sequence.map((stimulus, index) => ({
        position: index + 1, stimulus, warmup: index < 2,
        expected: index < 2 ? null : stimulus === sequence[index - 2],
        answer: null, correct: index < 2 ? null : false, rtMs: null, presentedAtMs: null
      }));
      let phase = 'ready', index = -1, epoch = 0, deadline = 0, shownAt = 0, digit, controls;
      const metrics = () => {
        const scored = trials.slice(2);
        return {
          correct: scored.filter(t => t.correct).length,
          matchCorrect: scored.filter(t => t.expected && t.correct).length,
          nonmatchCorrect: scored.filter(t => !t.expected && t.correct).length,
          missed: scored.filter(t => t.answer === null).length,
          trials: trials.map(t => ({ ...t })), sequence: [...sequence]
        };
      };
      const select = choice => {
        if (phase !== 'answering' || !resources.live() || ctx.now() >= deadline || trials[index].answer !== null) return;
        const trial = trials[index];
        trial.answer = choice === 0;
        trial.correct = trial.answer === trial.expected;
        trial.rtMs = ctx.now() - shownAt;
        controls.buttons.forEach(button => button.disabled = true);
        ctx.setStatus('已作答');
      };
      const show = next => {
        if (phase === 'done' || !resources.live()) return;
        const planned = epoch + next * 2000;
        if (ctx.now() - planned > 250) {
          phase = 'done';
          ctx.abort('数字呈现延迟超过 250 ms，本局因时序异常中断，不计入成绩。');
          return;
        }
        index = next; shownAt = ctx.now(); deadline = planned + 2000;
        trials[index].presentedAtMs = shownAt - epoch;
        phase = index < 2 ? 'warmup' : 'answering';
        digit.textContent = String(sequence[index]);
        controls.buttons.forEach(button => button.disabled = index < 2);
        ctx.setStage(index < 2 ? 'presenting' : 'answering');
        ctx.setProgress(index + 1, 25); ctx.setRemaining(deadline);
        ctx.setStatus(index < 2 ? '预热：记住数字，无需作答' : '与前两个位置的数字相比：1 相同 / 2 不同');
        ctx.schedule(() => { if (index === next) digit.textContent = ''; }, planned + 600 - ctx.now());
        ctx.schedule(() => {
          if (next === 24) { phase = 'done'; ctx.finish('completed', metrics()); }
          else show(next + 1);
        }, deadline - ctx.now());
      };
      return {
        start() {
          if (phase !== 'ready' || !resources.live()) return;
          ctx.container.replaceChildren();
          ctx.container.append(ui.el('div', 'question-prompt', '当前数字与前两个位置的数字相同吗？'));
          digit = ui.el('div', 'digit-display'); digit.setAttribute('aria-live', 'off');
          controls = ui.choices(ctx, ['相同', '不同'], select);
          ctx.container.append(digit, controls.panel);
          epoch = ctx.now(); show(0);
        },
        onTimeout() { phase = 'done'; resources.close(); return metrics(); },
        destroy() { phase = 'done'; resources.close(); }
      };
    }
  });

  M.registerGame({
    id: 'E2',
    createSession(host) {
      const layout = generators.E2(host.rng);
      const resources = managedContext(host), ctx = resources.ctx;
      let phase = 'ready', progress = 0, errors = 0, beganAt = null, endedAt = null, deadline = 0, controls;
      const errorTimers = new Map();
      const metrics = () => ({ completed: progress === 25, progress, errors,
        durationMs: beganAt === null ? null : Math.max(0, (endedAt === null ? Math.min(ctx.now(), deadline) : endedAt) - beganAt),
        layout: [...layout] });
      const select = index => {
        if (phase !== 'answering' || !resources.live() || ctx.now() >= deadline) return;
        const button = controls.buttons[index];
        if (layout[index] !== progress + 1) {
          errors++; button.classList.add('is-wrong'); button.setAttribute('aria-invalid', 'true');
          ctx.setStatus('请点击 ' + (progress + 1) + ' · 误点 ' + errors + ' 次');
          ctx.cancel(errorTimers.get(index));
          errorTimers.set(index, ctx.schedule(() => {
            button.classList.remove('is-wrong'); button.removeAttribute('aria-invalid'); errorTimers.delete(index);
          }, 250));
          return;
        }
        progress++; button.classList.add('matched');
        ctx.setProgress(progress, 25);
        if (progress === 25) {
          endedAt = ctx.now(); phase = 'done';
          controls.buttons.forEach(node => node.disabled = true);
          ctx.finish('completed', metrics());
        } else ctx.setStatus('请点击 ' + (progress + 1) + ' · 误点 ' + errors + ' 次');
      };
      return {
        start() {
          if (phase !== 'ready' || !resources.live()) return;
          ctx.container.replaceChildren();
          ctx.container.append(ui.el('div', 'question-prompt', '按 1 → 25 顺序点击；方向键移动，Enter 确认。'));
          controls = ui.grid(ctx, 25, 5, i => String(layout[i]), select);
          ctx.container.append(controls.board);
          beganAt = ctx.now(); deadline = Math.min(beganAt + 120000, ctx.sessionDeadline);
          phase = 'answering'; ctx.setStage('answering'); ctx.setProgress(0, 25);
          ctx.setRemaining(deadline); ctx.setStatus('请点击 1 · 误点 0 次');
        },
        onTimeout() {
          if (endedAt === null && beganAt !== null) endedAt = Math.min(ctx.now(), deadline);
          phase = 'done'; resources.close(); return metrics();
        },
        destroy() {
          if (endedAt === null && beganAt !== null) endedAt = Math.min(ctx.now(), deadline);
          phase = 'done'; resources.close();
        }
      };
    }
  });

  M.registerGame({
    id: 'E3',
    createSession(host) {
      const rounds = generators.E3(host.rng);
      const resources = managedContext(host), ctx = resources.ctx;
      const trials = rounds.map(round => ({ ...round, symbols: [...round.symbols], answer: null, correct: false, rtMs: null }));
      let phase = 'ready', index = 0, beganAt = 0, deadline = 0, pending, controls;
      const metrics = () => ({ correct: trials.filter(t => t.correct).length,
        meanCorrectMs: ui.mean(trials.filter(t => t.correct).map(t => t.rtMs)),
        trials: trials.map(t => ({ ...t, symbols: [...t.symbols] })) });
      const submit = (roundIndex, choice) => {
        if (phase !== 'answering' || index !== roundIndex || !resources.live()) return;
        if (choice !== null && ctx.now() >= deadline) return;
        phase = 'feedback'; ctx.cancel(pending);
        const round = rounds[index], trial = trials[index];
        trial.answer = choice; trial.correct = choice === round.targetIndex;
        trial.rtMs = choice === null ? null : ctx.now() - beganAt;
        controls.buttons.forEach((button, i) => {
          button.disabled = true;
          if (i === round.targetIndex) button.classList.add('matched');
          if (i === choice) button.classList.add('selected');
        });
        ctx.setStage('feedback');
        ui.feedback(ctx, trial.correct, (choice === null ? '超时。' : '') + '不同项在第 ' + (Math.floor(round.targetIndex / round.columns) + 1) + ' 行、第 ' + (round.targetIndex % round.columns + 1) + ' 列。');
        ctx.schedule(() => {
          index++;
          if (index === rounds.length) { phase = 'done'; ctx.finish('completed', metrics()); }
          else show();
        }, 500);
      };
      const show = () => {
        const round = rounds[index], roundIndex = index;
        ctx.container.replaceChildren();
        ctx.container.append(ui.el('div', 'question-prompt', '找出唯一方向不同的符号；第一次选择即提交。'));
        controls = ui.grid(ctx, round.symbols.length, round.columns, i => round.symbols[i], i => submit(roundIndex, i));
        const directions = { '↑': '向上箭头', '↓': '向下箭头', '←': '向左箭头', '→': '向右箭头' };
        controls.buttons.forEach((button, i) => button.setAttribute('aria-label', '第 ' + (Math.floor(i / round.columns) + 1) + ' 行、第 ' + (i % round.columns + 1) + ' 列，' + directions[round.symbols[i]]));
        ctx.container.append(controls.board);
        beganAt = ctx.now(); deadline = Math.min(beganAt + 15000, ctx.sessionDeadline);
        phase = 'answering'; ctx.setStage('answering'); ctx.setProgress(index + 1, rounds.length);
        ctx.setStatus('选择唯一不同项'); ctx.setRemaining(deadline);
        pending = ctx.schedule(() => submit(roundIndex, null), deadline - ctx.now());
      };
      return {
        start() { if (phase === 'ready' && resources.live()) show(); },
        onTimeout() { phase = 'done'; resources.close(); return metrics(); },
        destroy() { phase = 'done'; resources.close(); }
      };
    }
  });
})();
