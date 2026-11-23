(function () {
  'use strict';
  const M = window.MindOrbit;
  const U = M.ui;
  const colors = [
    { name: '红', ink: '#fb7185' },
    { name: '蓝', ink: '#60a5fa' },
    { name: '绿', ink: '#4ade80' },
    { name: '黄', ink: '#facc15' }
  ];
  M.generators = M.generators || {};

  function stroop(rng) {
    const options = rng.shuffle(colors.map(color => color.name));
    const questions = [];
    colors.forEach(ink => {
      const words = [ink, ...rng.sample(colors.filter(word => word !== ink), 2)];
      words.forEach(word => questions.push({
        id: `stroop-${ink.name}-${word.name}`,
        prompt: word.name,
        options: options.slice(),
        answer: options.indexOf(ink.name),
        limitMs: 3000,
        explanation: `正确墨色：${ink.name}。忽略文字含义，只看墨色。`,
        record: { word: word.name, ink: ink.name, inkColor: ink.ink, congruent: word === ink }
      }));
    });
    return rng.shuffle(questions);
  }
  function targets(rng) {
    const result = [];
    const positions = Array.from({ length: 9 }, (_, i) => i);
    for (let i = 0; i < 15; i++) result.push(rng.pick(positions.filter(position => position !== result[i - 1])));
    return result;
  }
  Object.assign(M.generators, { stroop, targets });

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
      frame(fn) { return ctx.frame(() => { if (active) fn(); }); },
      cancel(id) { if (id !== undefined) { ctx.cancel(id); timers.delete(id); } },
      freeze() { active = false; },
      destroy() { active = false; timers.forEach(id => ctx.cancel(id)); timers.clear(); }
    };
  }
  function feedback(node, correct, text) {
    node.className = 'game-feedback ' + (correct ? 'is-correct' : 'is-wrong');
    node.textContent = text;
  }

  M.registerGame({
    id: 'D1',
    createSession(ctx) {
      const life = lifetime(ctx), reactionTimes = [], trials = [], heldPointers = new Set();
      let started = false, accepting = false, heldSpace = false, phase = 'idle';
      let attempts = 0, penalties = 0, current = null, signalStart = null, deadline = 0, pending;
      let pad, message, samples;
      const metrics = () => ({ reactionTimes: reactionTimes.slice(), meanRtMs: U.mean(reactionTimes), medianRtMs: U.median(reactionTimes), penalties, attempts, trials: trials.slice() });
      function status() {
        ctx.setProgress(reactionTimes.length, 5);
        ctx.setStatus(`有效样本 ${reactionTimes.length} / 5 · 尝试 ${attempts} / 10 · 处罚 ${penalties}`);
        samples.textContent = reactionTimes.length ? `有效反应：${reactionTimes.map(rt => Math.round(rt) + ' ms').join('、')}。${reactionTimes.length < 5 ? '样本尚不足 5 次。' : '已收集完整样本。'}` : '暂无有效样本；需要收集 5 次有效反应。';
      }
      function record(outcome, rtMs = null) {
        if (!current) return;
        trials.push({ attempt: current.attempt, waitMs: current.waitMs, signalDelayMs: signalStart === null ? null : signalStart - current.startedAt, outcome, rtMs });
        if (outcome === 'valid') reactionTimes.push(rtMs);
        else penalties++;
        current = null;
      }
      function settle(outcome, rtMs = null) {
        if (!life.active || !accepting || !current) return;
        accepting = false;
        phase = 'feedback';
        life.cancel(pending);
        record(outcome, rtMs);
        // Keep the element enabled so pointerup still bubbles after a response.
        // Input is locked by accepting, not by disabling a held pointer's target.
        pad.setAttribute('aria-disabled', 'true');
        pad.classList.remove('lit');
        pad.textContent = '本次已结束';
        const text = {
          valid: `${rtMs === null ? '' : Math.round(rtMs)} ms · 有效反应`,
          'false-start': '抢跑：信号还没有出现。本次消耗一次尝试。',
          early: '过早：不足 100 ms，不计为有效样本。',
          missed: '漏答：请在信号出现后 1500 ms 内响应。'
        }[outcome];
        feedback(message, outcome === 'valid', text);
        ctx.setStage('feedback');
        ctx.setRemaining(ctx.now() + 500);
        status();
        life.later(() => {
          if (reactionTimes.length === 5 || attempts === 10) {
            life.destroy();
            ctx.finish(reactionTimes.length === 5 ? 'completed' : 'attempts_exhausted', metrics());
          } else begin();
        }, 500);
      }
      function respond() {
        if (!life.active || !accepting || ctx.now() >= deadline) return;
        if (phase === 'waiting') settle('false-start');
        else if (phase === 'signal') {
          const rtMs = ctx.now() - signalStart;
          settle(rtMs < 100 ? 'early' : 'valid', rtMs);
        }
      }
      function begin() {
        attempts++;
        signalStart = null;
        phase = 'waiting';
        accepting = true;
        // Waiting remains responsive for false starts; there is no visible signal countdown.
        deadline = ctx.sessionDeadline;
        const trial = current = { attempt: attempts, waitMs: ctx.rng.int(2000, 4000), startedAt: ctx.now() };
        pad.setAttribute('aria-disabled', 'false');
        pad.classList.remove('lit');
        pad.textContent = '等待信号，不要点击';
        message.textContent = '看到“现在点击”后，按此区域或空格键。';
        ctx.setStage('waiting');
        ctx.setRemaining(ctx.sessionDeadline);
        status();
        pending = life.later(() => {
          life.frame(() => {
            if (!accepting || current !== trial || phase !== 'waiting') return;
            // The visible signal and its timestamp change together, in the same animation frame.
            pad.textContent = '现在点击';
            pad.classList.add('lit');
            signalStart = ctx.now();
            deadline = signalStart + 1500;
            phase = 'signal';
            ctx.setStage('answering');
            ctx.setRemaining(deadline);
            pending = life.later(() => settle('missed'), deadline - ctx.now());
          });
        }, trial.waitMs);
      }
      return {
        start() {
          if (started || !life.active) return;
          started = true;
          pad = U.el('button', 'answer-button question-prompt reaction-pad');
          pad.type = 'button';
          message = U.el('div', 'game-feedback');
          message.setAttribute('role', 'status');
          samples = U.el('p', 'muted');
          ctx.container.replaceChildren(U.el('div', 'question-prompt', '信号出现后，尽快响应'), pad, message, samples, U.el('p', 'muted', '设备、触屏与浏览器延迟会影响结果；少于 100 ms 的响应记为过早，不代表医学或作弊判断。'));
          ctx.listen(pad, 'pointerdown', event => {
            if (event.button !== 0 || heldPointers.has(event.pointerId)) return;
            heldPointers.add(event.pointerId);
            event.preventDefault();
            pad.focus({ preventScroll: true });
            respond();
          });
          ctx.listen(document, 'pointerup', event => heldPointers.delete(event.pointerId));
          ctx.listen(document, 'pointercancel', event => heldPointers.delete(event.pointerId));
          U.keys(ctx, key => {
            if (key !== ' ' && key !== 'Spacebar') return false;
            if (!heldSpace) { heldSpace = true; respond(); }
            return true;
          });
          ctx.listen(document, 'keyup', event => { if (event.key === ' ' || event.key === 'Spacebar') heldSpace = false; });
          begin();
        },
        onTimeout() { accepting = false; life.freeze(); record('missed'); return metrics(); },
        destroy() { accepting = false; life.destroy(); heldPointers.clear(); heldSpace = false; }
      };
    }
  });

  M.registerGame({
    id: 'D2',
    createSession(ctx) {
      const life = lifetime(ctx), questions = stroop(ctx.rng);
      let started = false;
      // Use the shared quiz metrics, answer locking, keyboard handling and 500 ms feedback.
      const quizContext = Object.assign({}, ctx, {
        schedule: (fn, delay) => life.later(fn, delay),
        cancel: id => life.cancel(id),
        finish(outcome, metrics) { life.destroy(); ctx.finish(outcome, metrics); }
      });
      const quiz = U.quiz(quizContext, questions, {
        limitMs: 3000,
        render(question, container) {
          container.append(U.el('div', 'question-prompt', '选墨色，不选字义'));
          const word = U.el('div', 'digit-display stroop-word', question.prompt);
          word.style.color = question.record.inkColor;
          container.append(word, U.el('p', 'muted', '按 1–4 或点击颜色名称。按钮位置整局固定；色觉差异可能影响本任务表现。'));
        },
        renderOption(option) {
          const label = U.el('span', '', option);
          label.style.color = colors.find(color => color.name === option).ink;
          return label;
        }
      });
      return {
        start() { if (!started && life.active) { started = true; quiz.start(); } },
        onTimeout() { life.freeze(); quiz.destroy(); return quiz.onTimeout(); },
        destroy() { life.destroy(); quiz.destroy(); }
      };
    }
  });

  M.registerGame({
    id: 'D3',
    createSession(ctx) {
      const life = lifetime(ctx), positions = targets(ctx.rng);
      const trials = positions.map((target, index) => ({ index, target, scheduledMs: index * 2000, shownMs: null, outcome: 'unpresented', rtMs: null, errors: 0 }));
      let started = false, accepting = false, hits = 0, errors = 0, base = 0, index = -1, deadline = 0, shownAt = 0;
      let buttons, message;
      const metrics = () => ({ hits, misses: 15 - hits, errors, meanHitMs: U.mean(trials.filter(trial => trial.outcome === 'hit').map(trial => trial.rtMs)), trials: trials.map(trial => Object.assign({}, trial, { outcome: trial.outcome === 'pending' || trial.outcome === 'unpresented' ? 'missed' : trial.outcome })), targets: positions.slice() });
      const status = () => ctx.setStatus(`命中 ${hits} / 15 · 漏失 ${trials.filter(trial => trial.outcome === 'missed').length} · 误点 ${errors}`);
      function clear() {
        buttons.forEach((button, position) => {
          button.disabled = true;
          button.classList.remove('lit');
          button.textContent = '';
          button.setAttribute('aria-label', `第 ${Math.floor(position / 3) + 1} 行，第 ${position % 3 + 1} 列`);
        });
      }
      function select(position) {
        if (!life.active || !accepting || ctx.now() >= deadline) return;
        const trial = trials[index];
        if (position !== trial.target) {
          errors++;
          trial.errors++;
          feedback(message, false, '点到了空格，继续寻找目标');
          status();
          return;
        }
        accepting = false;
        hits++;
        trial.outcome = 'hit';
        trial.rtMs = ctx.now() - shownAt;
        clear();
        feedback(message, true, `命中 · ${Math.round(trial.rtMs)} ms`);
        ctx.setStage('feedback');
        ctx.setRemaining(base + (index + 1) * 2000);
        status();
      }
      function endWindow(slot) {
        if (index !== slot) return;
        accepting = false;
        if (trials[slot].outcome === 'pending') {
          trials[slot].outcome = 'missed';
          feedback(message, false, '本次漏失，准备下一个目标');
        }
        clear();
        ctx.setStage('waiting');
        ctx.setRemaining(base + (slot + 1) * 2000);
        status();
      }
      function tooLate(planned) {
        if (ctx.now() - planned <= 250) return false;
        accepting = false;
        life.destroy();
        ctx.abort('目标显示延迟超过 250 ms，本局已中断，不计入成绩。请关闭占用资源的程序后重试。');
        return true;
      }
      function present(slot) {
        const planned = base + slot * 2000;
        // Check both the timer and the render frame: a stalled final timer must
        // abort before the 30-second completion callback can settle the game.
        if (tooLate(planned)) return;
        life.frame(() => {
          if (tooLate(planned)) return;
          index = slot;
          clear();
          const target = buttons[positions[slot]];
          target.classList.add('lit');
          target.textContent = '●';
          target.setAttribute('aria-label', `第 ${Math.floor(positions[slot] / 3) + 1} 行，第 ${positions[slot] % 3 + 1} 列，目标`);
          shownAt = ctx.now();
          deadline = planned + 1500;
          trials[slot].shownMs = shownAt - base;
          trials[slot].outcome = 'pending';
          buttons.forEach(button => { button.disabled = false; });
          accepting = true;
          message.textContent = '点击亮起的目标；点空格会扣分';
          ctx.setProgress(slot + 1, 15);
          ctx.setStage('answering');
          ctx.setRemaining(deadline);
          status();
        });
      }
      return {
        start() {
          if (started || !life.active) return;
          started = true;
          const grid = U.grid(ctx, 9, 3, '', select);
          buttons = grid.buttons;
          message = U.el('div', 'game-feedback');
          message.setAttribute('role', 'status');
          ctx.container.replaceChildren(U.el('div', 'question-prompt', '点击目标，不要点空格'), grid.board, U.el('p', 'muted', '15 个目标 · 每 2 秒出现一个 · 命中后等待，不会提前出题'), message);
          clear();
          base = ctx.now();
          ctx.setStage('presenting');
          for (let slot = 0; slot < 15; slot++) {
            if (slot === 0) present(slot);
            else life.later(() => present(slot), base + slot * 2000 - ctx.now());
            life.later(() => endWindow(slot), base + slot * 2000 + 1500 - ctx.now());
          }
          life.later(() => {
            accepting = false;
            life.destroy();
            ctx.finish('completed', metrics());
          }, base + 30000 - ctx.now());
        },
        onTimeout() { accepting = false; life.freeze(); return metrics(); },
        destroy() { accepting = false; life.destroy(); }
      };
    }
  });
})();
