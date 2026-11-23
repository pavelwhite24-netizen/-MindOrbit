(function () {
  'use strict';
  const M = window.MindOrbit, { el } = M.ui, main = document.getElementById('main');
  const results = new Map();
  let lastAborted = '', audio, confirmationPending = false;
  const backend = { getItem: key => localStorage.getItem(key), setItem: (key,value) => localStorage.setItem(key,value), removeItem: key => localStorage.removeItem(key) };
  M.store = M.storage.create(backend);
  const applySettings = () => document.documentElement.dataset.motion = M.store.data.settings.reducedMotion;
  applySettings();
  M.sound = correct => {
    if (!M.store.data.settings.sound) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== 'running') return;
      const oscillator = audio.createOscillator(), gain = audio.createGain();
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.frequency.value = correct ? 660 : 260;
      gain.gain.setValueAtTime(0.035,audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime + 0.11);
      oscillator.start(); oscillator.stop(audio.currentTime + 0.12);
    } catch { /* Audio is optional; gameplay must remain silent when unavailable. */ }
  };
  const action = (text, fn, className = 'button primary') => { const node = el('button',className,text); node.type = 'button'; node.addEventListener('click',fn); return node; };
  const link = (text,path,className = 'button primary') => { const node = el('a',className,text); node.href = '#' + path; return node; };
  const icon = (name,className = 'icon') => { const image = el('img',className); image.src = 'assets/icons/' + name + '.svg'; image.alt = ''; image.width = 24; image.height = 24; return image; };
  const moduleOf = id => M.modules.find(module => module.id === id[0]);
  const summary = () => M.scoring.portrait(M.store.data);
  const totalSessions = () => Object.values(M.store.data.games).reduce((total,game) => total + Object.values(game.statsByRulesVersion).reduce((sum,value) => sum + value.completedCount,0),0);
  const fixed = number => number === null || number === undefined ? '未训练' : number.toFixed(1);
  const notice = () => {
    if (!M.store.persistent) { const node = el('div','notice warning',M.store.reason); node.setAttribute('role','status'); main.append(node); }
    else if (location.protocol === 'file:') main.append(el('div','notice','本地文件模式：可离线游玩；更换文件路径或浏览器可能无法读取原记录。'));
  };
  const heading = (eyebrow,title,subtitle) => {
    const node = el('div','page-heading'); node.append(el('span','eyebrow',eyebrow),el('h1','',title)); if (subtitle) node.append(el('p','muted',subtitle)); return node;
  };
  const sectionTitle = (title,subtitle) => { const node = el('div','section-title'); node.append(el('h2','',title)); if (subtitle) node.append(el('span','muted',subtitle)); return node; };
  const stat = (value,label) => { const node = el('div','stat'); node.append(el('strong','',value),el('span','muted',label)); return node; };
  const confirmation = (title,message,confirmText = '确认') => new Promise(resolve => {
    const dialog = document.getElementById('confirm-dialog');
    if (confirmationPending) { resolve(false); return; }
    confirmationPending = true;
    document.getElementById('dialog-title').textContent = title; document.getElementById('dialog-description').textContent = message;
    dialog.querySelector('[value="confirm"]').textContent = confirmText;
    dialog.returnValue = 'cancel'; dialog.addEventListener('close',() => { confirmationPending = false; resolve(dialog.returnValue === 'confirm'); },{once:true}); dialog.showModal();
  });
  const closeDialog = () => { const dialog = document.getElementById('confirm-dialog'); if (dialog.open) dialog.close('cancel'); };
  const svgElement = (tag,attributes) => { const node = document.createElementNS('http://www.w3.org/2000/svg',tag); for (const [key,value] of Object.entries(attributes || {})) node.setAttribute(key,value); return node; };
  const radar = portrait => {
    const svg = svgElement('svg',{viewBox:'0 0 300 255',class:'radar',role:'img','aria-label':`已训练 ${portrait.coverage} / 18 款游戏；缺失维度不记为零分`});
    const point = (i,r) => [150 + Math.sin(i*Math.PI/3)*r,125 - Math.cos(i*Math.PI/3)*r];
    for (const radius of [25,50,75,100]) svg.append(svgElement('polygon',{points:Array.from({length:6},(_,i)=>point(i,radius).join(',')).join(' '),fill:'none',stroke:'#32343e','stroke-width':1}));
    for (let i=0;i<6;i++) {
      const [x,y] = point(i,100), [tx,ty] = point(i,120);
      svg.append(svgElement('line',{x1:150,y1:125,x2:x,y2:y,stroke:'#32343e'}));
      const label = svgElement('text',{x:tx,y:ty+4,'text-anchor':'middle',fill:'#9c9eaf','font-size':12}); label.textContent = M.modules[i].name; svg.append(label);
    }
    if (portrait.modules.every(module=>module.complete)) svg.append(svgElement('polygon',{points:portrait.modules.map((module,i)=>point(i,module.score).join(',')).join(' '),fill:'#b6a0ff25',stroke:'#b6a0ff','stroke-width':2}));
    portrait.modules.forEach((module,i)=>{ if(module.score!==null) { const [cx,cy]=point(i,module.score); svg.append(svgElement('circle',{cx,cy,r:4,fill:M.modules[i].color})); } });
    return svg;
  };
  const home = () => {
    const portrait = summary(), today = M.storage.localDay(new Date()), streak = M.store.data.streak;
    const trainedToday = streak.lastLocalDay === today;
    const gap = streak.lastLocalDay ? M.storage.dayNumber(today) - M.storage.dayNumber(streak.lastLocalDay) : null;
    const recommendation = Object.keys(M.catalog).find(id=>portrait.games[id]?.score===null) || 'A1';
    const intro = heading('A LITTLE PRACTICE, A CLEARER MIND','给大脑，一点探索的时间。','不必追赶，不必比较。从一个小挑战开始，找到属于你的思维节奏。');
    intro.classList.add('home-heading'); main.append(intro);
    const hero = el('section','hero');
    const heroCopy = el('div','hero-copy'); heroCopy.append(el('span','pill','每天几分钟 · 保持好奇'),el('h2','','让思维，\n进入新的轨道。'),el('p','','18 个轻量小游戏，6 个探索方向。\n从记住一束光，到发现一条隐藏的规律。'),link('开始今日练习  ↗','/rules/'+recommendation),el('small','hero-footnote','无需注册 · 记录只留在你的浏览器'));
    const orbit = el('div','orbit-art'); orbit.setAttribute('aria-hidden','true');
    ['orbit-ring ring-one','orbit-ring ring-two','orbit-ring ring-three','orbit-core','orbit-dot dot-one','orbit-dot dot-two','orbit-dot dot-three','orbit-star star-one','orbit-star star-two'].forEach(cls=>orbit.append(el('span',cls)));
    const orbitLabel = el('div','orbit-label'); orbitLabel.append(el('strong','','18'),el('span','','种新的可能')); orbit.append(orbitLabel); hero.append(heroCopy,orbit); main.append(hero);
    const strip = el('section','stats-strip'); strip.append(stat(`${portrait.coverage} / 18`,'游戏探索覆盖'),stat(String(totalSessions()),'累计有效练习'),stat(trainedToday ? '已完成' : '待点亮','今日打卡'),stat(String(gap !== null && gap <= 1 ? streak.current : 0)+' 天','当前连续练习')); main.append(strip);
    if (gap !== null && gap > 1) main.append(el('p','streak-note','连续记录已中断，今日完成一局后重新开始。每一次回来都值得肯定。'));
    if (gap !== null && gap < 0) main.append(el('p','notice warning','设备日期早于最近打卡日，请检查日期或时区；成绩仍可记录。'));
    const columns = el('div','home-columns'), training = el('section','training-section'); training.append(sectionTitle('探索你的思维','6 个维度 · 每个维度 3 款游戏'));
    const cards = el('div','module-grid');
    M.modules.forEach((module,index)=> {
      const status = portrait.modules[index], card = link('','/module/'+module.id,'module-card'); card.style.setProperty('--accent',module.color);
      const top = el('div','card-top'), symbol = el('span','module-icon'); symbol.append(icon(module.icon)); top.append(symbol,el('span','card-number','0'+(index+1)));
      card.append(top,el('span','eyebrow',module.english.toUpperCase()),el('h3','',module.name),el('p','',module.description));
      const bottom = el('div','card-bottom'); bottom.append(el('span','',`${status.coverage} / 3 已探索`),el('span','card-arrow','↗')); card.append(bottom); cards.append(card);
    });
    training.append(cards); const aside = el('aside','portrait-panel'); aside.append(sectionTitle('你的思维画像'),el('p','muted','记录同一规则下的自己，不与他人排名。'),radar(portrait));
    const coverage = el('div','coverage-copy'); coverage.append(el('strong','',portrait.rank || '等待完整探索'),el('span','muted',portrait.rank ? `综合分 ${fixed(portrait.score)}` : `再体验 ${18-portrait.coverage} 款，解锁完整画像`)); aside.append(coverage);
    const track = el('div','coverage-track'); const fill = el('span'); fill.style.width = portrait.coverage/18*100+'%'; track.append(fill); aside.append(track);
    portrait.modules.forEach((module,index)=> { const row=el('div','portrait-row'); const label=el('span','',M.modules[index].name); label.style.setProperty('--accent',M.modules[index].color); row.append(label,el('span','',module.score===null?'未训练':`${fixed(module.score)}${module.complete?'':' · 暂定'}`)); aside.append(row); });
    aside.append(link('查看成长记录 →','/history','text-link'),el('p','fine-print','每款游戏取近 5 局均值；不同游戏得分不代表等量认知能力。')); columns.append(training,aside); main.append(columns);
    if (!totalSessions()) main.append(el('div','notice','初次见面：训练记录仅保存在当前浏览器。清除浏览器数据会丢失记录；这不是永久备份。'));
  };
  const miniTrend = history => {
    const svg = svgElement('svg',{viewBox:'0 0 320 70',class:'trend',role:'img','aria-label':'当前计分版本的保留单局成绩趋势'});
    svg.append(svgElement('line',{x1:4,x2:316,y1:64,y2:64,stroke:'#363743'}));
    if (!history.length) return svg;
    const segments=[]; let current=[];
    history.forEach((record,index)=>{ if(index && record.rulesVersion!==history[index-1].rulesVersion){segments.push(current);current=[];} current.push([history.length===1?160:6+308*index/(history.length-1),64-record.score*.56]); }); segments.push(current);
    for(const segment of segments){ svg.append(svgElement('polyline',{points:segment.map(point=>point.join(',')).join(' '),fill:'none',stroke:'currentColor','stroke-width':2})); segment.forEach(([cx,cy])=>svg.append(svgElement('circle',{cx,cy,r:2.5,fill:'currentColor'}))); }
    return svg;
  };
  const modulePage = id => {
    const module = moduleOf(id), portrait=summary(), value=portrait.modules.find(item=>item.id===id);
    main.append(link('← 训练空间','/','back-link'),heading(module.english.toUpperCase(),module.name,module.description));
    const banner=el('section','module-banner'); banner.style.setProperty('--accent',module.color); banner.append(stat(`${value.coverage} / 3`,'探索覆盖'),stat(fixed(value.score),value.complete?'模块均分':'已训练均值 · 暂定'),el('p','muted','各游戏近 5 局均值，三款等权。样本少于 5 局时仅作参考。')); main.append(banner);
    const cards=el('div','game-cards');
    Object.values(M.games).filter(game=>game.moduleId===id).forEach(game=> {
      const card=el('article','game-card');card.style.setProperty('--accent',module.color);
      card.append(el('span','eyebrow',game.id+' / '+game.duration),el('h2','',game.name),el('p','muted',game.tagline),el('span','pill subtle',game.scale));
      const data=M.store.data.games[game.id], stats=data?.statsByRulesVersion[game.rulesVersion], current=portrait.games[game.id];
      card.append(miniTrend((data?.history||[]).filter(item=>item.rulesVersion===game.rulesVersion).slice(-20)));
      const record=el('div','game-record');record.append(el('span','',`最佳 ${stats?.bestScore ?? '—'}`),el('span','',`近 ${current.samples} 局 ${fixed(current.score)}`));card.append(record,link('进入训练  →','/rules/'+game.id,'button secondary'));cards.append(card);
    });main.append(cards);
  };
  const rules = id => {
    const game=M.games[id],module=moduleOf(id); main.append(link('← '+module.name,'/module/'+module.id,'back-link'));
    const card=el('article','rules-card');card.style.setProperty('--accent',module.color);card.append(heading(game.id+' / '+module.english.toUpperCase(),game.name,game.tagline));
    const meta=el('div','rule-meta');meta.append(el('span','pill',game.scale),el('span','pill subtle',game.duration));card.append(meta);
    [['如何操作',game.instructions],['节奏与时限',game.timing],['怎样计分',game.scoring],['举个例子',game.example]].forEach(([title,text],index)=>{const row=el('section','rule-row');row.append(el('span','rule-index','0'+(index+1)));const copy=el('div');copy.append(el('h2','',title),el('p','',text));row.append(copy);card.append(row);});
    card.append(el('div','notice','开始前有 3 秒准备，正式局最多 120 秒。退出、刷新或切换到后台会中断且不记成绩；正常零分与规则内超时仍计入练习。'));
    const limitations = el('details','accessibility-note');limitations.append(el('summary','','设备与可达性说明'),el('p','muted','可用鼠标、触屏和适用的键盘操作；方格使用方向键移动焦点、Enter 选择，选择题可用数字键。视觉、色觉、输入设备与浏览器延迟会影响体验，本任务不保证辅助技术具有等价测量条件，可自由跳过。'));card.append(limitations,link('准备好了，开始训练  →','/play/'+id));main.append(card);
  };
  const play = id => {
    const game=M.games[id],module=moduleOf(id),page=el('section','play-page');page.style.setProperty('--accent',module.color);
    const top=el('div','play-top');top.append(el('span','eyebrow',module.name+' / '+game.id),action('退出训练',()=>M.router.go('/rules/'+id),'button ghost'));page.append(top,el('h1','',game.name));
    const toolbar=el('div','game-toolbar'),progress=el('span','','准备中'),timer=el('strong','','—'),total=el('span','','120s');toolbar.append(progress,timer);page.append(toolbar);
    const track=el('div','game-progress'),bar=el('span');track.append(bar);page.append(track);
    const status=el('p','game-status','准备开始'),container=el('div','game-arena');page.append(status,container);
    const bottom=el('div','game-bottom');bottom.append(el('span','','正式局剩余'),total,el('span','','切换页面将中断本局'));page.append(bottom);main.append(page);
    M.host=M.createHost(game,{container,status,progress,timer,total,bar},{
      onFinish(record,saved){closeDialog();results.set(record.sessionId,{record,saved});M.router.go('/result/'+record.sessionId);},
      onAbort(message){lastAborted=message;closeDialog(); if (!M.exiting) M.router.go('/interrupted/'+id);}
    });M.host.startPreparing();
  };
  const metricLabels={maxCorrectCells:'最高通过格数',correctRounds:'正确轮数',errors:'错误 / 误点',livesRemaining:'剩余生命',maxLength:'最长正确位数',matchedPairs:'配对数',moves:'翻牌步数',correct:'正确数',missed:'漏答数',meanCorrectMs:'正确题平均耗时',meanRtMs:'平均反应时',medianRtMs:'反应时中位数',penalties:'抢跑 / 过早 / 漏答',attempts:'尝试次数',hits:'命中数',misses:'漏失数',meanHitMs:'平均命中耗时',matchCorrect:'匹配题正确',nonmatchCorrect:'非匹配题正确',completed:'是否完成',progress:'完成进度',durationMs:'游戏耗时'};
  const result = sessionId => {
    let entry=results.get(sessionId);
    if(!entry) {const record=Object.values(M.store.data.games).flatMap(game=>game.history).find(item=>item.sessionId===sessionId);if(record)entry={record,saved:{saved:M.store.persistent,recordType:'none',best:M.store.data.games[record.gameId].statsByRulesVersion[record.rulesVersion].bestScore}};}
    if(!entry){main.append(heading('SESSION','这次结果已不在当前记录中','可能已刷新、清空，或超出每款游戏的 100 局保留范围。'),link('返回训练空间','/'));return;}
    const {record,saved}=entry,game=M.games[record.gameId],module=moduleOf(record.gameId);
    const card=el('section','result-card');card.style.setProperty('--accent',module.color);card.append(el('span','eyebrow','SESSION COMPLETE'),el('h1','',game.name+' · 训练完成'));
    const circle=el('div','score-circle');circle.style.setProperty('--score',record.score+'%');circle.append(el('strong','',record.score),el('span','','本局得分 / 100'));card.append(circle);
    const title={first:'你的首个纪录',new:'新的个人纪录',equal:'追平个人纪录',none:'每一次练习，都有新的发现'}[saved.recordType];card.append(el('h2','',title||'本局成绩'),el('p','muted',`个人最佳 ${saved.best} · 有效正式局 · 计分 v${record.rulesVersion}`));
    card.append(el('div','save-state '+(saved.saved?'':'warning'),saved.saved?'已保存到当前浏览器': '未保存到设备 · 本次仅存内存，刷新后可能丢失'));
    if(saved.rollback)card.append(el('p','notice warning','设备日期早于上次打卡；本局成绩已记录，打卡日期未倒退。'));
    const metrics=el('div','result-metrics');Object.entries(record.metrics).forEach(([key,value])=>{if(!metricLabels[key]||typeof value==='object'&&value!==null)return;metrics.append(stat(value===null?'无样本':typeof value==='boolean'?(value?'是':'否'):key.endsWith('Ms')?`${(value/1000).toFixed(3)} 秒`:String(value),metricLabels[key]));});card.append(metrics);
    if(record.metrics.reactionTimes)card.append(el('p','muted',`有效样本 ${record.metrics.reactionTimes.length} / 5：${record.metrics.reactionTimes.map(value=>Math.round(value)+' ms').join('、')||'无样本'}${record.metrics.reactionTimes.length<5?'（样本不足）':''}`));
    card.append(el('p','fine-print',`本局 ${(record.durationMs/1000).toFixed(1)} 秒 · 输入方式 ${ {pointer:'鼠标 / 触屏',keyboard:'键盘',mixed:'混合'}[record.inputMode] } · 设备延迟与练习熟悉度会影响结果`));
    const actions=el('div','result-actions');actions.append(link('再练一次 ↗','/play/'+game.id),link('返回'+module.name,'/module/'+module.id,'button secondary'));card.append(actions);
    if(record.metrics.trials?.length){const review=el('details','review');review.append(el('summary','','回顾本局过程与解析'));record.metrics.trials.forEach((trial,index)=>{const item=el('div','review-item');item.append(el('strong','',`第 ${index+1} 次${trial.correct!==undefined?' · '+(trial.correct?'正确':'未答对'):''}`));if(trial.explanation)item.append(el('p','',trial.explanation));const pre=el('pre','',JSON.stringify(trial,null,2));const raw=el('details');raw.append(el('summary','','查看原始记录'),pre);item.append(raw);review.append(item);});card.append(review);}main.append(card);
  };
  const interrupted = id => {main.append(heading('SESSION INTERRUPTED','先停一下，也没关系。',lastAborted||'本局已中断，不计入成绩与打卡。'),link('重新开始','/play/'+id),link('回看规则','/rules/'+id,'button secondary spaced'));};
  const historyPage = () => {
    const portrait=summary();main.append(heading('YOUR OWN PACE','成长，不止一个数字。','只和同一规则下的自己比较。每款保留最近 100 局，最佳与累计次数独立保存。'));
    const stats=el('div','stats-strip');stats.append(stat(String(totalSessions()),'有效练习总数'),stat(String(M.store.data.streak.totalDays),'累计打卡天数'),stat(String(M.store.data.streak.longest)+' 天','最长连续练习'),stat(portrait.rank||'未解锁','完整画像段位'));main.append(stats);
    const selector=el('select','history-select');selector.setAttribute('aria-label','选择游戏记录');Object.values(M.games).forEach(game=>{const option=el('option','',game.id+' · '+game.name);option.value=game.id;selector.append(option);});
    const first=Object.keys(M.store.data.games).find(id=>M.store.data.games[id].history.length);if(first)selector.value=first;main.append(selector);const content=el('section','history-content');main.append(content);
    const show=()=>{content.replaceChildren();const game=M.games[selector.value],records=M.store.data.games[game.id]?.history||[],current=portrait.games[game.id];content.style.setProperty('--accent',moduleOf(game.id).color);content.append(sectionTitle(game.name,`当前计分 v${game.rulesVersion} · 近 ${current.samples}/5 局均值 ${fixed(current.score)}`),miniTrend(records));if(!records.length){content.append(el('div','empty-state','这里还没有记录。你的第一次练习，就从现在开始。'),link('去试一局','/rules/'+game.id));return;}
      [...records].reverse().forEach(record=>{const row=link('','/result/'+record.sessionId,'history-row');row.append(el('span','',new Date(record.completedAt).toLocaleString('zh-CN')),el('span','muted',`v${record.rulesVersion} · ${(record.durationMs/1000).toFixed(1)} 秒`),el('strong','',record.score+' 分'),el('span','','↗'));content.append(row);});};selector.addEventListener('change',show);show();
  };
  const settingsPage = () => {
    main.append(heading('MAKE IT YOURS','让练习，舒服一点。','没有账号，没有远程追踪。你的选择和记录，仅属于当前浏览器。'));
    const card=el('section','settings-card');
    const soundRow=el('label','setting-row'),soundCopy=el('span');soundCopy.append(el('strong','','反馈音效'),el('small','muted','默认关闭；经典反应任务不使用声音信号。'));const sound=el('input');sound.type='checkbox';sound.checked=M.store.data.settings.sound;sound.setAttribute('aria-label','反馈音效');sound.addEventListener('change',()=>{M.store.settings({sound:sound.checked});if(sound.checked){try{audio||=new(window.AudioContext||window.webkitAudioContext)();audio.resume().then(()=>M.sound(true));}catch{}}});soundRow.append(soundCopy,sound);card.append(soundRow);
    const motionRow=el('label','setting-row'),motionCopy=el('span');motionCopy.append(el('strong','','减弱动效'),el('small','muted','只影响装饰动效，不改变游戏刺激节奏。'));const motion=el('select');motion.setAttribute('aria-label','减弱动效');[['system','跟随系统'],['on','开启'],['off','关闭']].forEach(([value,text])=>{const option=el('option','',text);option.value=value;motion.append(option);});motion.value=M.store.data.settings.reducedMotion;motion.addEventListener('change',()=>{M.store.settings({reducedMotion:motion.value});applySettings();});motionRow.append(motionCopy,motion);card.append(motionRow);
    card.append(sectionTitle('本地数据'),el('p','muted','支持同源浏览器内保存；更换域名、端口、浏览器或清理浏览器数据会影响记录。只支持一个活动写入页面，请勿同时在多个标签页训练。'),el('p','save-state',M.store.persistent?'存储状态：可保存到设备':'存储状态：仅内存模式'));
    if(M.store.raw&&!M.store.persistent){const details=el('details');details.append(el('summary','','查看原始存储内容（用于排查）'));const area=el('textarea');area.readOnly=true;area.value=M.store.raw;area.setAttribute('aria-label','原始存储内容');details.append(area);card.append(details);}
    card.append(action('清空全部本地记录',async()=>{if(await confirmation('清空所有记录？','此操作不可恢复，将删除本应用的成绩、打卡和偏好设置，不影响同源其他应用的数据。','确认清空')){M.store.reset();results.clear();applySettings();M.router.go('/settings',true);}},'button danger'));
    card.append(sectionTitle('关于 MindOrbit'),el('p','muted','18 款轻量脑力游戏。分数、画像和段位只是游戏练习反馈，不是智商测验，不作诊断、疗效或认知迁移承诺。请适度练习，疲劳时休息。'));
    const notices=el('a','text-link','开源与素材许可 ↗');notices.href='THIRD_PARTY_NOTICES.txt';notices.target='_blank';notices.rel='noopener';card.append(notices);main.append(card);
  };
  const render = path => {
    main.replaceChildren();main.classList.remove('is-playing');notice();
    const [,kind,id]=path.split('/');document.querySelectorAll('[data-nav]').forEach(node=>{const active=node.dataset.nav===(kind==='history'?'history':kind==='settings'?'settings':'home');node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
    document.getElementById('breadcrumb').textContent=kind==='history'?'成长记录':kind==='settings'?'偏好设置':id&&M.games[id]?moduleOf(id).name+' / '+M.games[id].name:kind==='module'?moduleOf(id).name:'训练空间';
    document.title=(id&&M.games[id]?M.games[id].name+' · ':'')+'MindOrbit · 脑力轨道';
    if(kind==='module')modulePage(id);else if(kind==='rules')rules(id);else if(kind==='play'){main.classList.add('is-playing');play(id);}else if(kind==='result')result(id);else if(kind==='interrupted')interrupted(id);else if(kind==='history')historyPage();else if(kind==='settings')settingsPage();else home();
    main.focus({preventScroll:true});
  };
  window.addEventListener('storage',event=>{if(event.key===M.storage.KEY){M.store.externalChange();const banner=el('div','notice warning',M.store.reason);banner.setAttribute('role','alert');main.prepend(banner);}});
  window.addEventListener('pagehide',()=>{if(M.host?.active){M.exiting=true;M.host.abort('页面已离开，本局不计分。');M.exiting=false;}});
  if(Object.keys(M.games).length!==18){main.replaceChildren(heading('LOAD ERROR','游戏文件未完整加载','请保留完整文件包，不要只移动首页文件，然后刷新重试。'));return;}
  M.router.init(render,async()=> {
    const host=M.host;if(!host?.active)return true;
    const confirmed=await confirmation('要结束这一局吗？','确认后本局将中断，不记成绩和打卡。此对话框不会暂停游戏时钟。','退出本局');
    if(!confirmed||!host.active)return false;
    M.exiting=true;host.abort('你已退出本局，不计入成绩。');M.exiting=false;return true;
  });
})();
