(function () {
  'use strict';
  const M = window.MindOrbit, { el } = M.ui, main = document.getElementById('main');
  const results = new Map();
  let lastAborted = '', audio, confirmationPending = false, pageCleanup = null;
  let selectedDay = M.storage.localDay(new Date());
  const abilityColors = ['#79a8ed','#efa968','#69c6c1','#e59ab7','#93b884','#aaa2dd'];
  const tileColors = ['#eaf2ff','#fff3e4','#e9f7f5','#fff0f4','#eef6e8','#f1effb'];
  const artwork = (name,className = 'game-illustration') => { const image = el('img',className); image.src = 'assets/illustrations/' + name + '.svg'; image.alt = ''; image.width = 180; image.height = 140; return image; };
  const allRecords = () => Object.values(M.store.data.games).flatMap(game => game.history).sort((a,b) => Date.parse(a.completedAt)-Date.parse(b.completedAt));
  const favorites = () => M.store.data.settings.favorites || [];
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
    const dimensions = ['C','F','D','E','A','B'].map(id => ({ ...portrait.modules.find(value => value.id === id), name: moduleOf(id).name }));
    const svg = svgElement('svg',{viewBox:'0 0 420 330',class:'radar',role:'img','aria-label':dimensions.map(value => value.name+' '+fixed(value.score)).join('，')});
    const point = (i,r) => [210 + Math.sin(i*Math.PI/3)*r,160 - Math.cos(i*Math.PI/3)*r];
    for (const radius of [100,75,50,25]) svg.append(svgElement('polygon',{points:dimensions.map((_,i)=>point(i,radius).join(',')).join(' '),fill:'#f7faff',stroke:'#dfe9f5','stroke-width':1}));
    dimensions.forEach((module,i) => {
      const [x,y] = point(i,100), [tx,ty] = point(i,136);
      svg.append(svgElement('line',{x1:210,y1:160,x2:x,y2:y,stroke:'#dfe9f5'}));
      const label = svgElement('text',{x:tx,y:ty,'text-anchor':'middle',fill:'#52667d','font-size':14}); label.textContent = module.name;
      const value = svgElement('tspan',{x:tx,dy:20,fill:'#397dd3','font-weight':600,'font-size':15}); value.textContent = module.score === null ? '—' : fixed(module.score); label.append(value); svg.append(label);
    });
    if (dimensions.every(value => value.score !== null)) svg.append(svgElement('polygon',{class:'radar-value',points:dimensions.map((value,i)=>point(i,value.score).join(',')).join(' '),fill:'#6da9f54a',stroke:'#609deb','stroke-width':2.5,'stroke-linejoin':'round'}));
    dimensions.forEach((value,i)=>{ if(value.score!==null) { const [cx,cy]=point(i,value.score); svg.append(svgElement('circle',{cx,cy,r:4,fill:'#609deb',stroke:'#fff','stroke-width':2})); } });
    return svg;
  };
  const dailyPlan = day => {
    const number = M.storage.dayNumber(day), offset = ((number % 6) + 6) % 6;
    return [0,2,4].map((step,i) => M.modules[(offset+step)%6].id + (1+((number+i)%3+3)%3));
  };
  const home = () => {
    const portrait = summary(), now = new Date(), today = M.storage.localDay(now), streak = M.store.data.streak, records = allRecords();
    const gap = streak.lastLocalDay ? M.storage.dayNumber(today)-M.storage.dayNumber(streak.lastLocalDay) : null;
    const intro = heading('DAILY TRAINING','每天一点，唤醒思维活力','从一个轻松的小挑战开始，积累属于你的进步。'); intro.classList.add('dashboard-heading'); main.append(intro);
    const week = el('div','week-strip'); week.setAttribute('role','group'); week.setAttribute('aria-label','选择本周训练日期');
    const monday = new Date(now.getFullYear(),now.getMonth(),now.getDate()-((now.getDay()+6)%7));
    const hero = el('section','daily-hero'); hero.setAttribute('aria-label','每日训练计划');
    const renderPlan = () => {
      hero.replaceChildren();
      const plan = dailyPlan(selectedDay), trained = new Set(records.filter(record => record.localDay===selectedDay && record.rulesVersion===M.games[record.gameId].rulesVersion).map(record=>record.gameId));
      const completed = plan.filter(id=>trained.has(id)).length, next = plan.find(id=>!trained.has(id)) || plan[0];
      const ring = el('div','daily-ring'), circle = svgElement('svg',{viewBox:'0 0 120 120','aria-hidden':'true'});
      circle.append(svgElement('circle',{cx:60,cy:60,r:52,fill:'none',stroke:'#ffffff38','stroke-width':7}),svgElement('circle',{cx:60,cy:60,r:52,fill:'none',stroke:'#fff','stroke-width':7,'stroke-linecap':'round',pathLength:100,'stroke-dasharray':`${completed/3*100} 100`,transform:'rotate(-90 60 60)'}));
      const ringCopy = el('div','ring-copy'); ringCopy.append(el('strong','',`${completed}/3`),el('small','','计划进度')); ring.append(circle,ringCopy);
      const copy = el('div','daily-copy'), top = el('div','daily-top');
      copy.append(el('span','eyebrow',selectedDay===today?'TODAY’S PLAN':selectedDay.replaceAll('-',' / ')),el('h2','','每日训练计划'),el('p','',completed===3?'今天的三个小目标，全部完成！':'3 个轻量挑战，让不同能力一起进步。'));
      const tags = el('div','plan-tags'); plan.forEach(id=>tags.append(el('span','',M.games[id].name+(trained.has(id)?' · 已完成':'')))); copy.append(tags);
      const start = selectedDay===today ? link(completed===3?'再练一次 →':'开始训练 →','/rules/'+next,'button start-button') : action('回到今日 →',()=>{selectedDay=today;updateDays();renderPlan();},'button start-button');
      top.append(ring,copy,start);
      const stats = el('div','daily-stats'); stats.append(stat(portrait.score===null?'—':fixed(portrait.score),'脑力值'),stat(String(gap!==null && gap>=0 && gap<=1 ? streak.current:0)+' 天','连续打卡'),stat(String(totalSessions())+' 次','累计次数'));
      hero.append(top,stats);
      const note = selectedDay>today?'未来日期仅预览计划，训练记入实际完成日期。':selectedDay<today?'历史进度根据本机保留记录展示，不补签、不改写成绩。':portrait.score===null?'完成全部 18 款游戏后解锁总脑力值。':'脑力值来自各游戏近 5 局成绩，只与自己比较。';
      hero.append(el('p','hero-footnote',note));
    };
    const updateDays = () => week.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.day===selectedDay)));
    for(let i=0;i<7;i++) {
      const date = new Date(monday.getFullYear(),monday.getMonth(),monday.getDate()+i), day = M.storage.localDay(date);
      const button = action('',()=>{selectedDay=day;updateDays();renderPlan();},'day-button'); button.dataset.day=day;
      button.setAttribute('aria-label',`${day}${day===today?' 今天':''}`); if(day===today)button.setAttribute('aria-current','date');
      button.append(el('small','',['周一','周二','周三','周四','周五','周六','周日'][i]),el('strong','',date.getDate()),el('span','day-dot'+(records.some(record=>record.localDay===day)?' done':''))); week.append(button);
    }
    if(![...week.children].some(button=>button.dataset.day===selectedDay))selectedDay=today;
    updateDays();renderPlan();main.append(week,hero);
    if(gap!==null && gap<0)main.append(el('p','notice warning','设备日期早于最近打卡日，请检查日期或时区。'));
    const quick = el('div','quick-cards');
    [['meditation','冥想','让呼吸带你慢下来','/all/meditation'],['favorites','我的收藏',favorites().length?`${favorites().length} 款喜欢的小游戏`:'把喜欢的训练留在这里','/favorites']].forEach(([art,title,subtitle,path])=>{
      const card = link('',path,'quick-card'), copy = el('div'); copy.append(el('h3','',title),el('p','',subtitle)); card.append(artwork(art,'quick-art'),copy,el('span','chevron','›')); quick.append(card);
    });main.append(quick);
    const title = sectionTitle('专项训练计划','6 个维度，找到你的练习方向'); main.append(title);
    const plans = el('div','plan-list');
    M.modules.forEach((module,index)=>{
      const card = link('','/module/'+module.id,'plan-card'), copy = el('div','plan-copy'); card.style.setProperty('--tile-bg',tileColors[index]);
      copy.append(el('h3','',module.name+'训练'),el('p','',module.description),el('span','plan-meta',`3 款游戏 · 已探索 ${portrait.modules[index].coverage}/3`));
      card.append(artwork(module.id+'1','plan-art'),copy,el('span','chevron','›')); plans.append(card);
    });main.append(plans);
  };
  const navigationTabs = (items,active,className,label) => {
    const nav = el('nav',className); nav.setAttribute('aria-label',label);
    items.forEach(([text,path,key])=>{const item=link(text,path,''); if(key===active)item.setAttribute('aria-current','page'); nav.append(item);});
    return nav;
  };
  const catalogGrid = ids => {
    const grid = el('div','catalog-grid');
    ids.forEach(id=>{
      const game=M.games[id], index=M.modules.findIndex(module=>module.id===game.moduleId), card=el('article','catalog-card'); card.dataset.game=id;card.style.setProperty('--tile-bg',tileColors[index]);
      const cover=link('','/rules/'+id,'game-cover');cover.setAttribute('aria-label',game.name+'，查看规则');cover.append(artwork(id));
      const favorite=action('',()=>{
        const next=favorites().includes(id)?favorites().filter(value=>value!==id):[...favorites(),id];
        const saved=M.store.settings({favorites:next});updateFavorite();
        status.textContent=saved?(next.includes(id)?'已添加到收藏':'已取消收藏'):'收藏仅存内存：'+M.store.reason;
        if(M.router.path==='/favorites'&&!next.includes(id)) {
          card.remove();
          if(!next.length)grid.replaceChildren(el('p','empty-state','还没有收藏，去全部游戏页挑选喜欢的训练吧。'));
          (grid.querySelector('.favorite-button') || main.querySelector('.text-link')).focus();
        }
      },'favorite-button');
      const star=svgElement('svg',{viewBox:'0 0 24 24',width:20,height:20,'aria-hidden':'true'});star.append(svgElement('path',{d:'m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 2.9 1.1-6.2L2.9 9.6l6.3-.9Z',fill:'currentColor',stroke:'currentColor','stroke-width':1.5,'stroke-linejoin':'round'}));favorite.append(star);
      const updateFavorite=()=>{const saved=favorites().includes(id);favorite.setAttribute('aria-pressed',String(saved));favorite.setAttribute('aria-label',(saved?'取消收藏':'收藏')+game.name);};updateFavorite();
      card.append(cover,favorite,link(game.name,'/rules/'+id,'game-name'),el('p','game-caption',game.duration));grid.append(card);
    });
    const status=el('p','fine-print');status.setAttribute('role','status');const section=el('div');section.append(grid,status);return section;
  };
  const favoritesPage = () => {
    main.append(heading('MY COLLECTION','我的收藏','喜欢的小游戏，下一次更快找到。'),link('浏览全部游戏 →','/all','text-link'));
    if(!favorites().length)main.append(el('div','empty-state','还没有收藏。在游戏卡片右上角点亮星标，就能收藏。'));
    else main.append(catalogGrid(favorites()));
  };
  const wellness = kind => {
    const meditation=kind==='meditation',card=el('section','wellness-card');
    card.append(heading(meditation?'TAKE A BREATH':'FOCUS TIME',meditation?'把注意力，交给呼吸':'一次，只专注一件事',meditation?'跟随提示，自然呼吸；感到不适时随时停止。':'给手边的小事一段不被打扰的时间。'));
    const orb=el('div','breathing-orb');orb.append(artwork(meditation?'meditation':'E2','quick-art'));
    const display=el('div','timer-display'),message=el('p','muted',meditation?'准备好了，慢慢开始':'选择一段专注时间');display.setAttribute('role','timer');display.setAttribute('aria-live','off');message.setAttribute('role','status');
    let minutes=meditation?3:25,remaining=minutes*60000,duration=remaining,deadline=0,running=false,timer=null;
    const options=el('div','duration-options');options.setAttribute('role','group');options.setAttribute('aria-label','选择时长');
    const format=()=>{const seconds=Math.ceil(remaining/1000);display.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');};
    const pause=()=>{remaining=Math.max(0,deadline-performance.now());running=false;clearInterval(timer);timer=null;orb.classList.remove('is-running');start.textContent='继续';options.querySelectorAll('button').forEach(button=>button.disabled=false);format();};
    const tick=()=>{
      remaining=Math.max(0,deadline-performance.now());format();
      if(!remaining){pause();start.textContent='再来一次';message.textContent=meditation?'练习完成，让呼吸回到自然节奏。':'本次专注完成，休息一下吧。';return;}
      if(meditation){const inhale=(duration-remaining)%10000<4000;message.textContent=inhale?'轻轻吸气':'慢慢呼气';orb.dataset.phase=inhale?'inhale':'exhale';}
    };
    const start=action('开始'+(meditation?'冥想':'专注'),()=>{
      if(running){pause();message.textContent='已暂停，准备好后再继续。';return;}
      if(!remaining){remaining=minutes*60000;duration=remaining;}
      running=true;deadline=performance.now()+remaining;start.textContent='暂停';orb.classList.add('is-running');options.querySelectorAll('button').forEach(button=>button.disabled=true);message.textContent=meditation?'轻轻吸气':'专注进行中';tick();timer=setInterval(tick,250);
    });start.dataset.action='start';
    const reset=action('重置',()=>{if(running)pause();remaining=minutes*60000;duration=remaining;format();start.textContent='开始'+(meditation?'冥想':'专注');message.textContent='已重置，按自己的节奏开始。';},'button secondary');reset.dataset.action='reset';
    (meditation?[1,3,5]:[5,15,25]).forEach(value=>{const button=action(value+' 分钟',()=>{minutes=value;remaining=value*60000;duration=remaining;format();options.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));start.textContent='开始'+(meditation?'冥想':'专注');},'button secondary');button.setAttribute('aria-pressed',String(value===minutes));options.append(button);});
    const controls=el('div','timer-actions');controls.append(start,reset);format();card.append(options,orb,display,message,controls,el('p','fine-print','离开此页将结束计时，切换到后台会暂停；不计入游戏成绩或打卡。'));main.append(card);
    const hidden=()=>{if(document.hidden&&running){pause();message.textContent='离开前台，计时已暂停。';}};document.addEventListener('visibilitychange',hidden);
    pageCleanup=()=>{clearInterval(timer);document.removeEventListener('visibilitychange',hidden);};
  };
  const allGamesPage = category => {
    main.append(heading('EXPLORE & PLAY','找到你的脑力小挑战','18 款小游戏，探索思维的不同可能。'),navigationTabs([['脑力','/all','brain'],['高级能力','/all/advanced','advanced'],['冥想','/all/meditation','meditation'],['番茄钟','/all/timer','timer']],category||'brain','category-tabs','游戏分类'));
    if(category==='meditation'||category==='timer'){wellness(category);return;}
    const advanced=['A2','C3','E1','F2','F3','B1'];
    if(category==='advanced')main.append(el('p','notice','进阶精选：工作记忆、空间推理与心算的组合挑战，沿用原有游戏规则。'));
    M.modules.forEach(module=>{
      const ids=Object.keys(M.games).filter(id=>id[0]===module.id&&(!category||advanced.includes(id)));if(!ids.length)return;
      const section=el('section','catalog-section');section.dataset.module=module.id;section.append(sectionTitle(module.name,module.description),catalogGrid(ids));main.append(section);
    });
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
  const scoreOverview = portrait => {
    const stats=el('div','score-summary');
    [['brain','总脑力值',portrait.score===null?'—':fixed(portrait.score),portrait.rank?portrait.rank+' · 满分 100':'完成全部 18 款后解锁'],['chart-no-axes-combined','训练进度',Math.round(portrait.coverage/18*100)+'%',`已探索 ${portrait.coverage} / 18 款游戏`]].forEach(([glyph,label,value,note])=>{
      const card=el('section','summary-card'),symbol=el('div','summary-icon'),copy=el('div');symbol.append(icon(glyph));copy.append(el('span','muted',label),el('strong','',value),el('small','',note));card.append(symbol,copy);stats.append(card);
    });main.append(stats);
    const badges=el('div','badge-strip');badges.setAttribute('role','group');badges.setAttribute('aria-label','训练徽章');
    const detail=el('p','badge-detail','每一步都值得记录。点选徽章，查看解锁条件。');detail.setAttribute('role','status');
    const items=[['初次启航','orbit',totalSessions()>0,'完成任意一局有效训练'],...M.modules.map((module,i)=>[module.name+'探索者',module.icon,portrait.modules[i].complete,`体验全部 3 款${module.name}游戏`]),['坚持一周','check',M.store.data.streak.longest>=7,'连续 7 天完成有效训练']];
    items.forEach(([name,glyph,unlocked,condition])=>{
      const badge=action('',()=>{badges.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button===badge)));detail.textContent=`${name} · ${unlocked?'已解锁':'未解锁'}：${condition}。`;},'badge'+(unlocked?'':' is-locked'));
      badge.setAttribute('aria-pressed','false');badge.setAttribute('aria-label',name+'，'+(unlocked?'已解锁':'未解锁'));const medal=el('span','badge-medallion');medal.append(icon(glyph));badge.append(medal,el('span','',name));badges.append(badge);
    });main.append(badges,detail);
  };
  const progressPanel = portrait => {
    const panel=el('section','score-panel');panel.append(sectionTitle('每一份进步，都看得见'),el('p','muted','分数达成度 = 当前能力分 ÷ 100；不是游戏完成率，未训练不记为零分。'));
    const list=el('div','progress-list');
    [{name:'总脑力',score:portrait.score,color:'#699eec',complete:portrait.score!==null},...portrait.modules.map((value,i)=>({...value,name:M.modules[i].name,color:abilityColors[i]}))].forEach(value=>{
      const row=el('div','progress-item'),label=el('div','progress-label'),track=el('div','progress-track'),fill=el('span');
      label.append(el('span','',value.name),el('strong','',value.score===null?'未解锁 / 未训练':`${fixed(value.score)}%${value.complete?'':' · 暂定'}`));
      track.setAttribute('role','progressbar');track.setAttribute('aria-label',value.name+'分数达成度');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');
      if(value.score!==null)track.setAttribute('aria-valuenow',String(value.score));track.setAttribute('aria-valuetext',value.score===null?'无训练数据':fixed(value.score)+'%'+(value.complete?'':'，暂定'));
      fill.style.width=(value.score??0)+'%';fill.style.setProperty('--progress-color',value.color);track.append(fill);row.append(label,track);list.append(row);
    });panel.append(list,el('p','fine-print','各游戏取当前计分版本的近 5 局均值，各模块三款游戏等权；样本较少时仅作参考。'));main.append(panel);
  };
  const pkPanel = () => {
    const panel=el('section','score-panel pk-panel');panel.id='personal-pk';panel.tabIndex=-1;panel.append(sectionTitle('脑力 PK · 和上一次的自己比'),el('p','muted','仅对比本机同一游戏、同一计分版本的最近两局，不提供联网匹配或他人排名。'));
    const records=Object.values(M.games).map(game=>({game,history:(M.store.data.games[game.id]?.history||[]).filter(record=>record.rulesVersion===game.rulesVersion).slice(-2)})).filter(value=>value.history.length===2);
    if(!records.length)panel.append(el('div','empty-state','同一款游戏完成两局后，就能在这里比较进步。'),link('选一款开始 →','/all'));
    records.forEach(({game,history})=>{const row=el('div','history-row'),delta=history[1].score-history[0].score;row.append(el('span','',game.name),el('span','muted',`${history[0].score} → ${history[1].score} 分`),el('strong','',(delta>0?'+':'')+delta+' 分'),link('挑战','/rules/'+game.id,'text-link'));panel.append(row);});
    return panel;
  };
  const radarPanel = portrait => {
    const panel=el('section','score-panel'),title=el('div','panel-heading'),copy=el('div');copy.append(el('h2','','你的六维脑力画像'),el('p','muted','找到擅长的方向，也发现新的可能。'));title.append(copy);panel.append(title);
    const layout=el('div','radar-layout'),aside=el('div','radar-aside');
    const pk=action('脑力 PK →',()=>{let target=document.getElementById('personal-pk');if(!target){target=pkPanel();main.append(target);}target.focus();target.scrollIntoView({block:'start'});},'button pk-button');
    aside.append(el('span','eyebrow','A LITTLE BETTER, EVERY DAY'),el('h3','',portrait.rank||'你的探索，刚刚开始'),el('p','muted',portrait.score===null?`再体验 ${18-portrait.coverage} 款，解锁完整脑力画像。`:'不追赶别人的步伐，只记录自己的变化。'),pk,el('small','muted','与上一次的自己比较'));
    layout.append(radar(portrait),aside);panel.append(layout);
    const legend=el('div','metric-legend');portrait.modules.forEach((value,i)=>{const item=el('div');item.append(el('span','',M.modules[i].name),el('strong','',value.score===null?'未训练':fixed(value.score)+(value.complete?'':' · 暂定')));legend.append(item);});
    panel.append(legend,el('p','fine-print','每款取近 5 局均值；缺少维度时只展示已有数据点，不用零分补齐。分数是游戏反馈，不是能力诊断。'));main.append(panel);
  };
  const growthChart = (points,range) => {
    const svg=svgElement('svg',{viewBox:'0 0 760 310',class:'growth-chart',role:'img','aria-label':'成长记录：横轴日期，纵轴总脑力值，范围 0 到 100'}),today=M.storage.dayNumber(M.storage.localDay(new Date()));
    const dated=points.map(point=>({...point,ordinal:M.storage.dayNumber(point.day)}));
    const end=range==='all'?Math.max(today,...dated.map(point=>point.ordinal)):today,start=range==='all'?Math.min(end-6,...dated.map(point=>point.ordinal)):end-Number(range)+1;
    const x=day=>56+(day-start)/Math.max(1,end-start)*676,y=score=>252-score*2;
    const text=(value,attributes)=>{const node=svgElement('text',attributes);node.textContent=value;svg.append(node);};
    const defs=svgElement('defs'),gradient=svgElement('linearGradient',{id:'growth-fill',x1:0,y1:0,x2:0,y2:1});gradient.append(svgElement('stop',{offset:'0%', 'stop-color':'#72aaf0','stop-opacity':.34}),svgElement('stop',{offset:'100%','stop-color':'#72aaf0','stop-opacity':.025}));defs.append(gradient);svg.append(defs);
    [0,25,50,75,100].forEach(score=>{svg.append(svgElement('line',{x1:56,x2:732,y1:y(score),y2:y(score),stroke:'#e7eef7','stroke-dasharray':'4 5'}));text(score,{x:40,y:y(score)+4,'text-anchor':'end',fill:'#7b8b9c','font-size':12});});
    text('脑力值',{x:16,y:23,fill:'#7b8b9c','font-size':12});text('日期',{x:732,y:303,'text-anchor':'end',fill:'#7b8b9c','font-size':12});
    for(let i=0;i<5;i++){const day=Math.round(start+(end-start)*i/4),date=new Date(day*86400000);text(`${date.getUTCMonth()+1}/${date.getUTCDate()}`,{x:x(day),y:279,'text-anchor':'middle',fill:'#7b8b9c','font-size':12});}
    let segment=[];const segments=[];dated.forEach(point=>{if(point.score===null){if(segment.length)segments.push(segment);segment=[];}else segment.push(point);});if(segment.length)segments.push(segment);
    segments.forEach(values=>{const line=values.map((point,i)=>(i?'L':'M')+x(point.ordinal)+' '+y(point.score)).join(' ');if(values.length>1){svg.append(svgElement('path',{class:'growth-area',d:line+` L${x(values.at(-1).ordinal)} 252 L${x(values[0].ordinal)} 252 Z`,fill:'url(#growth-fill)'}));svg.append(svgElement('path',{class:'growth-line',d:line,fill:'none',stroke:'#659fe9','stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'}));}
      values.forEach(point=>{const node=svgElement('circle',{class:'growth-point',cx:x(point.ordinal),cy:y(point.score),r:5,fill:'#fff',stroke:'#659fe9','stroke-width':2,tabindex:0,'aria-label':`${point.day} 总脑力值 ${fixed(point.score)}`});const title=svgElement('title');title.textContent=`${point.day} · ${fixed(point.score)} 分`;node.append(title);svg.append(node);});});
    if(!dated.some(point=>point.score!==null))text('等待你的第一段成长曲线',{x:394,y:145,'text-anchor':'middle',fill:'#7087a1','font-size':18});
    return svg;
  };
  const recordsPanel = () => {
    const timeline=M.scoring.timeline(M.store.data),panel=el('section','score-panel'),title=el('div','panel-heading'),copy=el('div');copy.append(el('h2','','成长记录'),el('p','muted','一点一滴的练习，汇成看得见的成长。'));const ranges=el('div','chart-range');ranges.setAttribute('role','group');ranges.setAttribute('aria-label','成长记录时间范围');title.append(copy,ranges);panel.append(title);
    const chart=el('div'),description=el('p','chart-summary');description.setAttribute('role','status');let range='30';
    const show=()=>{ranges.querySelectorAll('button').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.range===range)));const today=M.storage.dayNumber(M.storage.localDay(new Date()));const points=timeline.filter(point=>range==='all'||(M.storage.dayNumber(point.day)<=today&&M.storage.dayNumber(point.day)>today-Number(range)));chart.replaceChildren(growthChart(points,range));const valid=points.filter(point=>point.score!==null);description.textContent=valid.length?`${valid.length} 个训练日 · 最近总脑力值 ${fixed(valid.at(-1).score)}${valid.length===1?' · 再完成一个训练日后连接趋势线':''}`:'此范围内暂无完整脑力值。体验全部 18 款游戏后，将开始绘制总脑力曲线。';};
    [['7','近 7 天'],['30','近 30 天'],['all','全部']].forEach(([value,label])=>{const button=action(label,()=>{range=value;show();},'button ghost');button.dataset.range=value;ranges.append(button);});
    panel.append(chart,description,el('p','fine-print','按训练日末的近 5 局均值汇总，六模块等权；仅根据每款保留的最近 100 局重建，不混合旧计分版本，不补齐缺失数据。'));show();main.append(panel);
    const content=el('section','history-content'),header=sectionTitle('最近训练'),selector=el('select','history-select');selector.setAttribute('aria-label','选择游戏记录');
    [['all','全部游戏'],...Object.values(M.games).map(game=>[game.id,game.name])].forEach(([id,name])=>{const option=el('option','',name);option.value=id;selector.append(option);});header.append(selector);const rows=el('div'),more=action('显示更多',()=>{limit+=30;showRecords();},'button secondary');let limit=30;
    const showRecords=()=>{rows.replaceChildren();const records=allRecords().reverse().filter(record=>selector.value==='all'||record.gameId===selector.value);more.hidden=records.length<=limit;
      if(!records.length){rows.append(el('div','empty-state','这里还没有训练记录，第一步就从今天开始。'),link('去训练 →','/all'));return;}
      records.slice(0,limit).forEach(record=>{const row=link('','/result/'+record.sessionId,'history-row');row.append(el('span','',M.games[record.gameId].name),el('span','muted',new Date(record.completedAt).toLocaleString('zh-CN')+` · v${record.rulesVersion}`),el('strong','',record.score+' 分'),el('span','','›'));rows.append(row);});};
    selector.addEventListener('change',()=>{limit=30;showRecords();});content.append(header,rows,more);showRecords();main.append(content);
  };
  const scoresPage = (tab='radar') => {
    const portrait=summary(),title=heading('MY GROWTH','每一次练习，都有回响','不必与别人比较，认识自己的每一点进步。');title.classList.add('score-heading');main.append(title);scoreOverview(portrait);
    main.append(navigationTabs([['脑力雷达','/scores/radar','radar'],['训练记录','/scores/records','records'],['训练进度','/scores/progress','progress']],tab,'score-tabs','成绩视图'));
    if(tab==='records')recordsPanel();else if(tab==='progress')progressPanel(portrait);else radarPanel(portrait);
  };
  const settingsPage = () => {
    main.append(heading('MY SPACE','我的练习空间','记录留在本机，练习按照自己的节奏。'));
    const profile=el('section','profile-card'),avatar=el('span','profile-mark','M'),copy=el('div');copy.append(el('h2','','本地练习者'),el('p','muted',`${totalSessions()} 次训练 · ${M.store.data.streak.totalDays} 天打卡`));profile.append(avatar,copy,link('我的收藏 →','/favorites','text-link'));main.append(profile);
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
    if(pageCleanup){pageCleanup();pageCleanup=null;}
    main.replaceChildren();main.classList.remove('is-playing');notice();
    const [,kind,id]=path.split('/'),activeNav=['history','scores','result'].includes(kind)?'scores':kind==='settings'?'settings':['all','favorites','module','rules','play','interrupted'].includes(kind)?'all':'home';
    document.querySelectorAll('[data-nav]').forEach(node=>{const active=node.dataset.nav===activeNav;node.classList.toggle('active',active);if(active)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});
    const pageName=kind==='favorites'?'我的收藏':id&&M.games[id]?M.games[id].name:kind==='module'?moduleOf(id).name:({home:'训练',all:'全部游戏',scores:'我的成绩',settings:'我的'})[activeNav];
    document.getElementById('breadcrumb').textContent=pageName;
    document.title=pageName+' · MindOrbit 脑力轨道';
    if(kind==='module')modulePage(id);else if(kind==='rules')rules(id);else if(kind==='play'){main.classList.add('is-playing');play(id);}else if(kind==='result')result(id);else if(kind==='interrupted')interrupted(id);else if(kind==='history')scoresPage('records');else if(kind==='scores')scoresPage(id||'radar');else if(kind==='all')allGamesPage(id);else if(kind==='favorites')favoritesPage();else if(kind==='settings')settingsPage();else home();
    main.focus({preventScroll:true});
  };
  window.addEventListener('storage',event=>{if(event.key===M.storage.KEY){M.store.externalChange();const banner=el('div','notice warning',M.store.reason);banner.setAttribute('role','alert');main.prepend(banner);}});
  window.addEventListener('pagehide',()=>{if(pageCleanup){pageCleanup();pageCleanup=null;}if(M.host?.active){M.exiting=true;M.host.abort('页面已离开，本局不计分。');M.exiting=false;}});
  if(Object.keys(M.games).length!==18){main.replaceChildren(heading('LOAD ERROR','游戏文件未完整加载','请保留完整文件包，不要只移动首页文件，然后刷新重试。'));return;}
  M.router.init(render,async()=> {
    const host=M.host;if(!host?.active)return true;
    const confirmed=await confirmation('要结束这一局吗？','确认后本局将中断，不记成绩和打卡。此对话框不会暂停游戏时钟。','退出本局');
    if(!confirmed||!host.active)return false;
    M.exiting=true;host.abort('你已退出本局，不计入成绩。');M.exiting=false;return true;
  });
})();
