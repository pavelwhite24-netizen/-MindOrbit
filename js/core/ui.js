(function () {
  'use strict';
  const M = window.MindOrbit;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const button = (ctx, label, callback, className = 'answer-button') => {
    const node = el('button', className, label);
    node.type = 'button';
    ctx.listen(node, 'pointerdown', event => {
      if (event.button !== 0 || node.disabled) return;
      event.preventDefault(); node.focus({ preventScroll: true }); callback(event);
    });
    ctx.listen(node, 'click', event => { if (event.detail === 0 && !node.disabled) callback(event); });
    return node;
  };
  const keys = (ctx, callback) => ctx.listen(document, 'keydown', event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) return;
    if (callback(event.key, event)) event.preventDefault();
  });
  const grid = (ctx, count, columns, label, action) => {
    const board = el('div', 'game-grid'); board.style.setProperty('--columns', columns);
    const buttons = Array.from({ length: count }, (_, i) => {
      const node = button(ctx, typeof label === 'function' ? label(i) : label, () => action(i), 'grid-cell');
      node.dataset.index = i;
      node.tabIndex = 0;
      board.append(node); return node;
    });
    ctx.listen(board, 'keydown', event => {
      if (event.repeat) { event.preventDefault(); return; }
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const change = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      if (change === undefined) return;
      event.preventDefault();
      for (let step = 1; step <= count; step++) {
        const target = (i + change * step + count * count) % count;
        if (!buttons[target].disabled) { buttons[target].focus(); break; }
      }
    });
    return { board, buttons };
  };
  const feedback = (ctx, correct, explanation) => {
    const node = el('div', 'game-feedback ' + (correct ? 'is-correct' : 'is-wrong'), (correct ? '正确 · ' : '未答对 · ') + explanation);
    node.setAttribute('role', 'status'); ctx.container.append(node);
    M.sound?.(correct);
  };
  const choices = (ctx, options, select, render) => {
    const panel = el('div', 'answer-options');
    const buttons = options.map((option, index) => {
      const node = button(ctx, '', () => select(index));
      node.append(el('span', 'key-hint', index + 1));
      if (render) node.append(render(option)); else node.append(el('span', '', String(option)));
      panel.append(node); return node;
    });
    keys(ctx, key => { const i = Number(key) - 1; if (i >= 0 && i < buttons.length && panel.isConnected && !buttons[i].disabled) { select(i); return true; } return false; });
    return { panel, buttons };
  };
  const quiz = (ctx, questions, config = {}) => {
    let index = 0, accepting = false, started = false, destroyed = false, questionStart = 0, deadline = 0, pending;
    const trials = [];
    const metrics = () => ({ correct: trials.filter(t => t.correct).length, missed: questions.length - trials.filter(t => t.answer !== null).length, meanCorrectMs: mean(trials.filter(t => t.correct).map(t => t.rtMs)), trials: [...trials] });
    const answer = choice => {
      if (!accepting) return;
      if (ctx.now() >= deadline) choice = null;
      accepting = false; ctx.cancel(pending);
      const question = questions[index];
      const correct = choice === question.answer;
      trials.push({ id: question.id, answer: choice, correct, rtMs: Math.min(ctx.now() - questionStart, question.limitMs || config.limitMs || 12000), explanation: question.explanation || '', stimulus: question.record || question.prompt || question.id });
      ctx.container.querySelectorAll('button').forEach(node => node.disabled = true);
      feedback(ctx, correct, (choice === null ? '超时。' : '') + (question.explanation || ''));
      ctx.setStage('feedback');
      ctx.schedule(() => { if (destroyed) return; index++; if (index === questions.length) ctx.finish('completed', metrics()); else show(); }, 500);
    };
    const show = () => {
      if (destroyed) return;
      ctx.container.replaceChildren(); ctx.setProgress(index + 1, questions.length); ctx.setStage('answering');
      const question = questions[index];
      if (config.render) config.render(question, ctx.container); else ctx.container.append(el('div', 'question-prompt', question.prompt));
      const controls = choices(ctx, question.options, answer, config.renderOption);
      ctx.container.append(controls.panel);
      questionStart = ctx.now(); deadline = questionStart + (question.limitMs || config.limitMs || 12000); ctx.setRemaining(deadline);
      accepting = true; pending = ctx.schedule(() => answer(null), deadline - ctx.now());
    };
    const stop = () => { destroyed = true; accepting = false; ctx.cancel(pending); return metrics(); };
    return { start() { if (!started && !destroyed) { started = true; ctx.setStatus('首次选择即提交；支持数字键选择答案。'); show(); } }, onTimeout: stop, destroy: stop };
  };
  M.ui = { el, button, keys, grid, choices, feedback, quiz, mean, median };
})();
