(function () {
  'use strict';
  const M = window.MindOrbit;
  const U = M.ui;
  const cells = Array.from({ length: 16 }, (_, i) => i);
  const symbols = ['●', '▲', '■', '◆', '＋', 'A', 'B', 'C'];
  M.generators = M.generators || {};

  // Retry patterns are new even when a seeded draw repeats the previous one.
  function matrix(rng, count, previous = []) {
    const result = rng.sample(cells, count).sort((a, b) => a - b);
    if (result.join(',') === previous.slice().sort((a, b) => a - b).join(',')) {
      result[0] = rng.pick(cells.filter(index => !result.includes(index)));
      result.sort((a, b) => a - b);
    }
    return result;
  }
  function digits(rng, length, previous = '') {
    let result = Array.from({ length }, () => String(rng.int(0, 9))).join('');
    if (result === previous) result = result.slice(0, -1) + ((Number(result[length - 1]) + rng.int(1, 9)) % 10);
    return result;
  }
  function memoryPairs(rng) { return rng.shuffle(symbols.flatMap(symbol => [symbol, symbol])); }
  Object.assign(M.generators, { matrix, digits, memoryPairs });

  function lifetime(ctx) {
    let active = true;
    const timers = new Set();
    return {
      get active() { return active; },
      later(fn, delay) {
        const id = ctx.schedule(() => { timers.delete(id); if (active) fn(); }, Math.max(0, delay));
        timers.add(id);
        return id;
      },
      cancel(id) { if (id !== undefined) { ctx.cancel(id); timers.delete(id); } },
      freeze() { active = false; },
      destroy() { active = false; timers.forEach(id => ctx.cancel(id)); timers.clear(); }
    };
  }
  function feedback(node, correct, text) {
    node.className = 'game-feedback ' + (correct ? 'is-correct' : 'is-wrong');
    node.textContent = text;
  }
  const cellLabel = index => `第 ${Math.floor(index / 4) + 1} 行，第 ${index % 4 + 1} 列`;

  M.registerGame({
    id: 'A1',
    createSession(ctx) {
      const life = lifetime(ctx), trials = [];
      let started = false, accepting = false, count = 3, lives = 3, maxCorrectCells = 0;
      let targets = [], selected = new Set(), current = null, answerStart = null, deadline = 0, pending;
      let board, buttons, prompt, selection, confirm, message;
      const metrics = () => ({ maxCorrectCells, correctRounds: trials.filter(t => t.correct).length, errors: trials.filter(t => !t.correct).length, livesRemaining: lives, trials: trials.slice() });
      const status = () => ctx.setStatus(`记忆 ${count} 格 · 剩余 ${lives} 条命 · 已通过 ${maxCorrectCells || 0} 格`);
      function updateSelection() {
        selection.textContent = `已选 ${selected.size} / ${count} 格，可再次点击取消`;
        confirm.disabled = !accepting || selected.size !== count;
        buttons.forEach((button, index) => {
          button.classList.toggle('selected', selected.has(index));
          button.setAttribute('aria-pressed', String(selected.has(index)));
        });
      }
      function select(index) {
        if (!life.active || !accepting || ctx.now() >= deadline) return;
        if (selected.has(index)) selected.delete(index);
        else if (selected.size < count) selected.add(index);
        updateSelection();
      }
      function record(outcome) {
        if (!current) return;
        const correct = outcome === 'correct';
        trials.push({ cells: current.slice(), count, selected: [...selected].sort((a, b) => a - b), correct, outcome, rtMs: answerStart === null ? null : Math.min(8000, Math.max(0, ctx.now() - answerStart)) });
        if (correct) maxCorrectCells = count;
        else lives = Math.max(0, lives - 1);
        current = null;
      }
      function settle(outcome) {
        if (!life.active || !accepting) return;
        accepting = false;
        life.cancel(pending);
        record(outcome);
        buttons.forEach(button => { button.disabled = true; });
        confirm.disabled = true;
        ctx.setStage('feedback');
        ctx.setRemaining(ctx.now() + 500);
        feedback(message, outcome === 'correct', outcome === 'correct' ? `完整还原 ${count} 格！` : `${outcome === 'timeout' ? '作答超时' : '位置未完全一致'}，剩余 ${lives} 条命。`);
        status();
        life.later(() => {
          if (maxCorrectCells === 8 || lives === 0) {
            life.destroy();
            ctx.finish(lives === 0 ? 'lives_exhausted' : 'completed', metrics());
          } else {
            if (outcome === 'correct') count++;
            show();
          }
        }, 500);
      }
      function submit() {
        if (!life.active || !accepting || ctx.now() >= deadline || selected.size !== count) return;
        settle(targets.every(index => selected.has(index)) ? 'correct' : 'incorrect');
      }
      function show() {
        targets = matrix(ctx.rng, count, targets);
        current = targets.slice();
        selected = new Set();
        answerStart = null;
        accepting = false;
        message.textContent = '';
        prompt.textContent = `记住亮起的 ${count} 个格子`;
        ctx.setStage('presenting');
        ctx.setProgress(count - 2, 6);
        status();
        updateSelection();
        buttons.forEach((button, index) => {
          button.disabled = true;
          button.classList.toggle('lit', targets.includes(index));
          button.textContent = targets.includes(index) ? '●' : '';
          button.setAttribute('aria-label', cellLabel(index) + (targets.includes(index) ? '，亮格' : ''));
        });
        ctx.setRemaining(ctx.now() + 1200);
        life.later(() => {
          buttons.forEach((button, index) => {
            button.classList.remove('lit');
            button.textContent = '';
            button.setAttribute('aria-label', cellLabel(index));
          });
          prompt.textContent = '稍等，准备还原';
          ctx.setRemaining(ctx.now() + 300);
          life.later(() => {
            prompt.textContent = `还原 ${count} 个位置，再按确认`;
            answerStart = ctx.now();
            deadline = answerStart + 8000;
            accepting = true;
            buttons.forEach(button => { button.disabled = false; });
            ctx.setStage('answering');
            ctx.setRemaining(deadline);
            updateSelection();
            pending = life.later(() => settle('timeout'), deadline - ctx.now());
          }, 300);
        }, 1200);
      }
      return {
        start() {
          if (started || !life.active) return;
          started = true;
          prompt = U.el('div', 'question-prompt');
          selection = U.el('p', 'muted');
          ({ board, buttons } = U.grid(ctx, 16, 4, '', select));
          confirm = U.button(ctx, '确认', submit);
          message = U.el('div', 'game-feedback');
          message.setAttribute('role', 'status');
          ctx.container.replaceChildren(prompt, board, selection, confirm, message);
          U.keys(ctx, (key, event) => { if (key === 'Enter' && accepting && !event.target.closest('.game-grid')) { submit(); return true; } return false; });
          show();
        },
        onTimeout() { accepting = false; life.freeze(); record('timeout'); return metrics(); },
        destroy() { accepting = false; life.destroy(); }
      };
    }
  });

  M.registerGame({
    id: 'A2',
    createSession(ctx) {
      const life = lifetime(ctx), trials = [];
      let started = false, accepting = false, length = 3, maxLength = 0, errors = 0;
      let sequence = '', entered = '', current = false, answerStart = null, deadline = 0, pending;
      let prompt, display, hint, keypad, digitButtons, backspace, confirm, message;
      const metrics = () => ({ maxLength, errors, trials: trials.slice() });
      function updateInput() {
        display.textContent = entered + '＿'.repeat(length - entered.length);
        hint.textContent = `已输入 ${entered.length} / ${length} 位 · 数字键、退格、Enter 均可使用`;
        confirm.disabled = !accepting || entered.length !== length;
        backspace.disabled = !accepting || entered.length === 0;
      }
      function setControls(enabled) {
        digitButtons.forEach(button => { button.disabled = !enabled; });
        backspace.disabled = !enabled || !entered.length;
        confirm.disabled = !enabled || entered.length !== length;
      }
      function record(outcome) {
        if (!current) return;
        const correct = outcome === 'correct';
        trials.push({ length, sequence, answer: answerStart === null ? null : entered, correct, outcome, rtMs: answerStart === null ? null : Math.min(6000, Math.max(0, ctx.now() - answerStart)) });
        if (correct) maxLength = length;
        else errors++;
        current = false;
      }
      function settle(outcome) {
        if (!life.active || !accepting) return;
        accepting = false;
        life.cancel(pending);
        record(outcome);
        setControls(false);
        ctx.setStage('feedback');
        ctx.setRemaining(ctx.now() + 500);
        feedback(message, outcome === 'correct', outcome === 'correct' ? `${length} 位顺序完全正确！` : `${outcome === 'timeout' ? '作答超时' : '顺序不正确'}。正确序列：${sequence}`);
        ctx.setStatus(`最长正确 ${maxLength} 位 · 累计错误 ${errors} / 2`);
        life.later(() => {
          if (maxLength === 9 || errors === 2) {
            life.destroy();
            ctx.finish(errors === 2 ? 'lives_exhausted' : 'completed', metrics());
          } else {
            if (outcome === 'correct') length++;
            show();
          }
        }, 500);
      }
      function input(key) {
        if (!life.active || !accepting || ctx.now() >= deadline) return;
        if (/^[0-9]$/.test(key)) {
          if (entered.length === length) return;
          entered += key;
        } else if (key === 'Backspace') entered = entered.slice(0, -1);
        else if (key === 'Enter') {
          if (entered.length === length) settle(entered === sequence ? 'correct' : 'incorrect');
          return;
        } else return;
        updateInput();
      }
      function openAnswer() {
        display.textContent = '';
        prompt.textContent = `按原顺序输入 ${length} 位数字`;
        answerStart = ctx.now();
        deadline = answerStart + 6000;
        accepting = true;
        updateInput();
        setControls(true);
        ctx.setStage('answering');
        ctx.setRemaining(deadline);
        pending = life.later(() => settle('timeout'), deadline - ctx.now());
      }
      function play(index) {
        // Only the currently visible digit enters the DOM; no hidden sequence or answer attributes.
        display.textContent = sequence[index];
        hint.textContent = `第 ${index + 1} / ${length} 位 · 播放时不能输入`;
        life.later(() => {
          display.textContent = '';
          life.later(() => { if (index + 1 === length) openAnswer(); else play(index + 1); }, 200);
        }, 600);
      }
      function show() {
        sequence = digits(ctx.rng, length, sequence);
        current = true;
        entered = '';
        answerStart = null;
        accepting = false;
        message.textContent = '';
        setControls(false);
        prompt.textContent = `记住接下来依次出现的 ${length} 位数字`;
        ctx.setProgress(length - 2, 7);
        ctx.setStatus(`最长正确 ${maxLength} 位 · 累计错误 ${errors} / 2`);
        ctx.setStage('presenting');
        ctx.setRemaining(ctx.now() + length * 800);
        play(0);
      }
      return {
        start() {
          if (started || !life.active) return;
          started = true;
          prompt = U.el('div', 'question-prompt');
          display = U.el('div', 'digit-display');
          hint = U.el('p', 'muted');
          keypad = U.el('div', 'answer-options digit-keypad');
          digitButtons = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(digit => U.button(ctx, digit, () => input(digit)));
          backspace = U.button(ctx, '退格', () => input('Backspace'));
          confirm = U.button(ctx, '确认', () => input('Enter'));
          keypad.append(...digitButtons, backspace, confirm);
          message = U.el('div', 'game-feedback');
          message.setAttribute('role', 'status');
          ctx.container.replaceChildren(prompt, display, hint, keypad, message);
          U.keys(ctx, key => {
            if (/^[0-9]$/.test(key) || key === 'Backspace' || key === 'Enter') { input(key); return true; }
            return false;
          });
          show();
        },
        onTimeout() { accepting = false; life.freeze(); record('timeout'); return metrics(); },
        destroy() { accepting = false; life.destroy(); }
      };
    }
  });

  M.registerGame({
    id: 'A3',
    createSession(ctx) {
      const life = lifetime(ctx), layout = memoryPairs(ctx.rng), matched = new Set();
      let started = false, accepting = false, first = null, moves = 0, matchedPairs = 0, startedAt = null;
      let deadline = ctx.sessionDeadline, buttons, message;
      const metrics = () => ({ matchedPairs, moves, durationMs: startedAt === null ? 0 : Math.max(0, Math.min(ctx.now(), deadline) - startedAt), layout: layout.slice() });
      const status = () => { ctx.setStatus(`已配对 ${matchedPairs} / 8 · ${moves} 步`); ctx.setProgress(matchedPairs, 8); };
      function cover(index) {
        buttons[index].textContent = '◇';
        buttons[index].classList.remove('selected');
        buttons[index].setAttribute('aria-label', `第 ${index + 1} 张牌，未翻开`);
      }
      function flip(index) {
        if (!life.active || !accepting || ctx.now() >= deadline || first === index || matched.has(index)) return;
        const card = buttons[index];
        card.textContent = layout[index];
        card.classList.add('selected');
        card.setAttribute('aria-label', `第 ${index + 1} 张牌，${layout[index]}`);
        if (first === null) { first = index; message.textContent = '再翻一张，寻找相同符号'; return; }
        const previous = first;
        first = null;
        moves++;
        if (layout[previous] === layout[index]) {
          matchedPairs++;
          [previous, index].forEach(position => {
            matched.add(position);
            buttons[position].classList.remove('selected');
            buttons[position].classList.add('matched');
            buttons[position].disabled = true;
            buttons[position].setAttribute('aria-label', `第 ${position + 1} 张牌，${layout[position]}，已配对`);
          });
          feedback(message, true, '配对成功，继续寻找下一对');
          status();
          if (matchedPairs === 8) {
            accepting = false;
            life.destroy();
            ctx.finish('completed', metrics());
          }
        } else {
          accepting = false;
          buttons.forEach(button => { button.disabled = true; });
          ctx.setStage('feedback');
          feedback(message, false, '两个符号不同，记住它们的位置');
          status();
          life.later(() => {
            cover(previous);
            cover(index);
            buttons.forEach((button, position) => { button.disabled = matched.has(position); });
            message.textContent = '选择两张未配对的牌';
            accepting = true;
            ctx.setStage('answering');
          }, 700);
        }
      }
      return {
        start() {
          if (started || !life.active) return;
          started = true;
          const grid = U.grid(ctx, 16, 4, '◇', flip);
          buttons = grid.buttons;
          buttons.forEach((button, index) => cover(index));
          message = U.el('div', 'game-feedback', '选择两张未配对的牌');
          message.setAttribute('role', 'status');
          ctx.container.replaceChildren(U.el('div', 'question-prompt', '找到全部 8 对相同符号'), grid.board, message);
          startedAt = ctx.now();
          deadline = ctx.sessionDeadline;
          accepting = true;
          ctx.setStage('answering');
          ctx.setRemaining(deadline);
          status();
        },
        onTimeout() { accepting = false; life.freeze(); return metrics(); },
        destroy() { accepting = false; life.destroy(); }
      };
    }
  });
})();
