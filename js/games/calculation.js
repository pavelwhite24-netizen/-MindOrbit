(function () {
  'use strict';
  const M = window.MindOrbit;
  const ui = M.ui;
  const generators = M.generators = M.generators || {};

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
      // Listener removal belongs to the host; its return value is not a disposer.
      return ctx.listen(target, event, e => {
        if (!live() || target.isConnected === false) return;
        if (e.repeat) { e.preventDefault(); return; }
        fn(e);
      });
    };
    local.finish = (outcome, metrics) => { if (live()) { close(); ctx.finish(outcome, metrics); } };
    return { ctx: local, close, live };
  }

  function optionsFor(rng, answer, min, max, preferred) {
    const legal = value => Number.isInteger(value) && value >= min && value <= max && value !== answer;
    const candidates = [...new Set(preferred.filter(legal))];
    const distractors = rng.sample(candidates, Math.min(3, candidates.length));
    if (distractors.length < 3) {
      const remaining = Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(value => legal(value) && !distractors.includes(value));
      distractors.push(...rng.sample(remaining, 3 - distractors.length));
    }
    return rng.shuffle([answer, ...distractors]);
  }

  generators.F1 = function (rng) {
    const specifications = [['+', 3], ['-', 3], ['*', 2], ['/', 2]];
    const symbols = { '+': '+', '-': '−', '*': '×', '/': '÷' };
    const problems = [];
    // Sampling finite pools avoids retries and duplicate (including commuted) questions.
    specifications.forEach(([operator, count]) => {
      const pool = [];
      if (operator === '+') {
        for (let a = 0; a <= 50; a++) for (let b = a; b <= 50; b++) pool.push([a, b, a + b]);
      } else if (operator === '-') {
        for (let a = 0; a <= 100; a++) for (let b = 0; b <= a; b++) pool.push([a, b, a - b]);
      } else if (operator === '*') {
        for (let a = 2; a <= 9; a++) for (let b = a; b <= 9; b++) pool.push([a, b, a * b]);
      } else {
        for (let divisor = 2; divisor <= 9; divisor++) for (let quotient = 1; quotient <= 9; quotient++) pool.push([divisor * quotient, divisor, quotient]);
      }
      rng.sample(pool, count).forEach(([left, right, result]) => {
        if ((operator === '+' || operator === '*') && rng.int(0, 1)) [left, right] = [right, left];
        problems.push({ left, operator, right, result });
      });
    });
    return rng.shuffle(problems).map((problem, index) => {
      const { left, operator, right, result } = problem;
      const options = optionsFor(rng, result, 0, 100, [-10, -5, -2, -1, 1, 2, 5, 10].map(offset => result + offset));
      const expression = left + ' ' + symbols[operator] + ' ' + right;
      return { id: 'F1-' + (index + 1), prompt: expression + ' = ?', options,
        answer: options.indexOf(result), explanation: expression + ' = ' + result,
        record: { ...problem, options: [...options] } };
    });
  };

  generators.F2 = function (rng) {
    return [3, 4, 5, 6, 7].map((length, index) => {
      const sequence = Array.from({ length }, () => rng.int(1, 9));
      const total = sequence.reduce((sum, value) => sum + value, 0);
      const preferred = sequence.map(value => total - value).concat([-3, -2, -1, 1, 2, 3].map(offset => total + offset));
      const options = optionsFor(rng, total, length, 9 * length, preferred);
      return { id: 'F2-' + (index + 1), sequence, total, options, answer: options.indexOf(total) };
    });
  };

  generators.F3 = function (rng, pool = M.twentyFour) {
    if (!Array.isArray(pool)) throw new Error('24 点题库未就绪，无法开始。');
    const solvable = [], unsolvable = [], seenCards = new Set(), seenIds = new Set();
    pool.forEach(row => {
      if (!row || (typeof row.id !== 'string' && typeof row.id !== 'number') || row.id === '' ||
          !Array.isArray(row.cards) || row.cards.length !== 4 || !row.cards.every(n => Number.isInteger(n) && n >= 1 && n <= 9) ||
          typeof row.solvable !== 'boolean' || (row.solvable ? typeof row.expression !== 'string' || !row.expression.trim() : row.expression !== null)) {
        throw new Error('24 点题库格式异常，无法开始。');
      }
      const key = [...row.cards].sort((a, b) => a - b).join(',');
      if (seenCards.has(key) || seenIds.has(row.id)) throw new Error('24 点题库存在重复牌组或 ID，无法开始。');
      seenCards.add(key); seenIds.add(row.id);
      (row.solvable ? solvable : unsolvable).push(row);
    });
    if (solvable.length < 4 || unsolvable.length < 4) throw new Error('24 点题库不足四组有解及四组无解题，无法开始。');
    return rng.shuffle([...rng.sample(solvable, 4), ...rng.sample(unsolvable, 4)]).map(row => ({
      id: row.id, prompt: '这四张牌能通过四则运算得到 24 吗？', options: ['能', '不能'], answer: row.solvable ? 0 : 1,
      explanation: row.solvable ? '能：' + row.expression + ' = 24' : '不能：在每张牌恰好使用一次、只允许四则运算与括号的规则下，穷举无解（允许分数及负数中间结果）。',
      record: { cards: [...row.cards], solvable: row.solvable, expression: row.expression }
    }));
  };

  // Keep the authoritative quiz UI, while retaining raw, null-valued missing trials
  // and gating its delayed feedback callbacks after a session has been destroyed.
  function quizSession(host, questions, config) {
    const resources = managedContext(host), ctx = resources.ctx;
    let state = 'ready', result = null, quiz;
    const normalize = raw => {
      const byId = new Map(raw.trials.map(trial => [trial.id, trial]));
      const trials = questions.map(question => {
        const trial = byId.get(question.id);
        return trial ? { ...trial, rtMs: trial.answer === null ? null : trial.rtMs } : {
          id: question.id, answer: null, correct: false, rtMs: null,
          explanation: question.explanation, stimulus: question.record
        };
      });
      return { correct: trials.filter(t => t.correct).length, missed: trials.filter(t => t.answer === null).length,
        meanCorrectMs: ui.mean(trials.filter(t => t.correct).map(t => t.rtMs)), trials };
    };
    ctx.finish = (outcome, raw) => {
      if (state !== 'running' || !resources.live()) return;
      result = normalize(raw); state = 'done'; quiz.destroy(); resources.close();
      host.finish(outcome, result);
    };
    quiz = ui.quiz(ctx, questions, config);
    const stop = () => {
      if (result === null) result = normalize(quiz.onTimeout());
      state = 'done'; quiz.destroy(); resources.close();
    };
    return {
      start() {
        if (state !== 'ready' || !resources.live()) return;
        state = 'running'; ctx.setStatus('首次选择即提交；支持数字键选择答案。'); quiz.start();
      },
      onTimeout() { stop(); return result; },
      destroy: stop
    };
  }

  M.registerGame({
    id: 'F1',
    createSession(ctx) { return quizSession(ctx, generators.F1(ctx.rng), { limitMs: 5000 }); }
  });

  M.registerGame({
    id: 'F2',
    createSession(host) {
      const rounds = generators.F2(host.rng);
      const resources = managedContext(host), ctx = resources.ctx;
      const trials = rounds.map(round => ({ id: round.id, sequence: [...round.sequence], total: round.total,
        options: [...round.options], answer: null, correct: false, rtMs: null }));
      let phase = 'ready', index = 0, beganAt = 0, deadline = 0, pending, digit, controls;
      const metrics = () => ({ correct: trials.filter(t => t.correct).length,
        missed: trials.filter(t => t.answer === null).length,
        trials: trials.map(t => ({ ...t, sequence: [...t.sequence], options: [...t.options] })) });
      const submit = (roundIndex, choice) => {
        if (phase !== 'answering' || index !== roundIndex || !resources.live()) return;
        if (choice !== null && ctx.now() >= deadline) return;
        phase = 'feedback'; ctx.cancel(pending);
        const round = rounds[index], trial = trials[index];
        trial.answer = choice; trial.correct = choice === round.answer;
        trial.rtMs = choice === null ? null : ctx.now() - beganAt;
        controls.buttons.forEach(button => button.disabled = true);
        ctx.setStage('feedback');
        ui.feedback(ctx, trial.correct, (choice === null ? '超时。' : '') + round.sequence.join(' + ') + ' = ' + round.total);
        ctx.schedule(() => {
          index++;
          if (index === rounds.length) { phase = 'done'; ctx.finish('completed', metrics()); }
          else show();
        }, 500);
      };
      const openAnswers = roundIndex => {
        if (index !== roundIndex || phase !== 'blank') return;
        const round = rounds[index];
        digit.textContent = '';
        controls = ui.choices(ctx, round.options, choice => submit(roundIndex, choice));
        ctx.container.append(controls.panel);
        beganAt = ctx.now(); deadline = Math.min(beganAt + 7000, ctx.sessionDeadline);
        phase = 'answering'; ctx.setStage('answering'); ctx.setRemaining(deadline);
        ctx.setStatus('请选择刚才所有数字的总和');
        pending = ctx.schedule(() => submit(roundIndex, null), deadline - ctx.now());
      };
      const present = (roundIndex, position) => {
        if (index !== roundIndex || (phase !== 'presenting' && phase !== 'blank')) return;
        const round = rounds[index];
        phase = 'presenting'; digit.textContent = String(round.sequence[position]);
        ctx.setStatus('记住并累加 · 第 ' + (position + 1) + ' / ' + round.sequence.length + ' 个数字');
        ctx.schedule(() => {
          phase = 'blank'; digit.textContent = '';
          ctx.schedule(() => {
            if (position + 1 === round.sequence.length) openAnswers(roundIndex);
            else present(roundIndex, position + 1);
          }, 200);
        }, 700);
      };
      const show = () => {
        const round = rounds[index];
        ctx.container.replaceChildren(); controls = null;
        ctx.container.append(ui.el('div', 'question-prompt', '逐个累加数字，播放结束后选择总和；不能重播。'));
        digit = ui.el('div', 'digit-display'); digit.setAttribute('aria-live', 'polite');
        ctx.container.append(digit);
        phase = 'presenting'; ctx.setStage('presenting'); ctx.setProgress(index + 1, rounds.length);
        ctx.setRemaining(Math.min(ctx.now() + round.sequence.length * 900, ctx.sessionDeadline));
        present(index, 0);
      };
      return {
        start() { if (phase === 'ready' && resources.live()) show(); },
        onTimeout() { phase = 'done'; resources.close(); return metrics(); },
        destroy() { phase = 'done'; resources.close(); }
      };
    }
  });

  M.registerGame({
    id: 'F3',
    createSession(ctx) {
      // Validate and sample before start; the host treats unavailable content as an abort.
      const questions = generators.F3(ctx.rng);
      return quizSession(ctx, questions, { limitMs: 12000, render(question, container) {
        const cards = ui.el('div', 'number-cards');
        question.record.cards.forEach(value => cards.append(ui.el('span', 'number-card', value)));
        container.append(ui.el('div', 'question-prompt', question.prompt), cards);
      } });
    }
  });
})();
