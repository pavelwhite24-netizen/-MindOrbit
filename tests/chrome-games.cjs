'use strict';
const {launch,clockScript}=require('./chrome-driver.cjs');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const b=await launch(),report={browser:b.version.Browser,date:new Date().toISOString(),golden:[],timeouts:[],responsive:[],checks:[]};
 const run=code=>b.evaluate(code), advance=ms=>run(`testClock.advance(${ms})`);
 const route=path=>run(`MindOrbit.router.go(${JSON.stringify(path)})`);
 const record=id=>run(`MindOrbit.store.data.games['${id}']?.history.at(-1)`);
 async function begin(id){await route('/rules/'+id);assert.equal(await run('document.querySelector("h1").textContent'),await run(`MindOrbit.games['${id}'].name`));await b.click(`a[href="#/play/${id}"]`);assert.equal(await run('MindOrbit.host.state'),'preparing');await advance(3000);assert.equal(await run('MindOrbit.host.state'),'running',id);}
 async function closeConfirmation(value){await run('void(window.dialogClosed=new Promise(resolve=>document.querySelector("dialog").addEventListener("close",()=>queueMicrotask(resolve),{once:true})))');await b.click(`dialog [value="${value}"]`);await run('window.dialogClosed');}
 async function options(index){await b.click(`.answer-options .answer-button:nth-child(${index+1})`);}
 async function questions(id){return run(`MindOrbit.generators[${JSON.stringify(id==='D2'?'stroop':id)}](MindOrbit.random(window.testSeed))`);}
 try{
  await b.send('Page.addScriptToEvaluateOnNewDocument',{source:clockScript});
  await b.navigate('http://127.0.0.1:4173/');
  await run('const originalRandom=MindOrbit.random;MindOrbit.random=seed=>{window.testSeed=seed;return originalRandom(seed)}');
  assert.equal(await run('MindOrbit.scoring.portrait(MindOrbit.store.data).score'),null);
  const ids=await run('Object.keys(MindOrbit.games)');
  for(const id of ids){
   await begin(id);
   await b.send('Emulation.setDeviceMetricsOverride',{width:320,height:800,deviceScaleFactor:1,mobile:true});
   const layout=await run(`({width:innerWidth,scroll:document.documentElement.scrollWidth,smallCells:[...document.querySelectorAll('.grid-cell')].filter(n=>n.getBoundingClientRect().width<44||n.getBoundingClientRect().height<44).length})`);
   assert.equal(layout.scroll,layout.width,id+' overflow');assert.equal(layout.smallCells,0,id+' touch targets');report.responsive.push({id,...layout});
   if(['A1','A2','B1','B2','C2','E2','F3'].includes(id))await b.screenshot(path.join(__dirname,'screenshots/'+id+'-mobile.png'));
   if(id==='A1'){
    for(let size=3;size<=8;size++){const cells=await run('[...document.querySelectorAll(".grid-cell.lit")].map(n=>n.dataset.index)');assert.equal(cells.length,size);await advance(1500);for(const i of cells)await b.click(`.grid-cell[data-index="${i}"]`);await b.click('.game-arena > .answer-button');await advance(500);}
   }else if(id==='A2'){
    for(let size=3;size<=9;size++){let sequence='';for(let i=0;i<size;i++){sequence+=await run('document.querySelector(".digit-display").textContent');await advance(800);}for(const character of sequence)await b.key(character,'Digit'+character,character.charCodeAt(0));if(size===9)await b.screenshot(path.join(__dirname,'screenshots/A2-input-mobile.png'));await b.key('Enter','Enter',13);await advance(500);}
   }else if(id==='A3'){
    const layout=await run('MindOrbit.generators.memoryPairs(MindOrbit.random(window.testSeed))');for(const value of new Set(layout)){const indices=layout.map((item,index)=>item===value?index:-1).filter(index=>index>=0);for(const i of indices)await b.click(`.grid-cell[data-index="${i}"]`);}
   }else if(id==='D1'){
    for(let i=0;i<5;i++){for(let t=0;t<210&&await run('MindOrbit.host.stage')!=='answering';t++)await advance(20);assert.equal(await run('MindOrbit.host.stage'),'answering');await advance(150);await b.click('.reaction-pad');await advance(500);}
   }else if(id==='D3'){
    await advance(16);for(let i=0;i<15;i++){await b.click('.grid-cell.lit');await advance(i===14?1984:2000);}
   }else if(id==='E1'){
    const sequence=await run('MindOrbit.generators.E1(MindOrbit.random(window.testSeed))');await advance(4000);for(let i=2;i<25;i++){await advance(600);await options(sequence[i]===sequence[i-2]?0:1);await advance(1400);}
   }else if(id==='E2'){
    const layout=await run('[...document.querySelectorAll(".grid-cell")].map(n=>Number(n.textContent))');for(let n=1;n<=25;n++)await b.click(`.grid-cell[data-index="${layout.indexOf(n)}"]`);
   }else if(id==='E3'){
    for(let i=0;i<6;i++){const index=await run(`(()=>{const nodes=[...document.querySelectorAll('.grid-cell')];return nodes.findIndex(node=>nodes.filter(n=>n.textContent===node.textContent).length===1)})()`);await advance(100);await b.click(`.grid-cell[data-index="${index}"]`);await advance(500);}
   }else if(id==='F2'){
    for(let length=3;length<=7;length++){let sum=0;for(let i=0;i<length;i++){sum+=Number(await run('document.querySelector(".digit-display").textContent'));await advance(900);}const index=await run(`([...document.querySelectorAll('.answer-options .answer-button')].findIndex(node=>Number(node.lastChild.textContent)===${sum}))`);assert.ok(index>=0);await options(index);await advance(500);}
   }else{
    const list=await questions(id);for(const question of list){await advance(100);await options(question.answer);await advance(500);}
   }
   assert.equal(await run('MindOrbit.host.state'),'finished',id+' should finish');const result=await record(id);assert.equal(result.score,100,id+' perfect score');assert.equal(result.gameId,id);assert.match(await run('document.querySelector(".save-state").textContent'),/已保存/);report.golden.push({id,score:result.score,durationMs:result.durationMs,inputMode:result.inputMode});console.log('GOLDEN',id,result.score);
  }
  assert.equal(await run('MindOrbit.scoring.portrait(MindOrbit.store.data).coverage'),18);assert.equal(await run('MindOrbit.scoring.portrait(MindOrbit.store.data).rank'),'黑洞');report.checks.push('18-game coverage and composite unlock');
  await route('/');await b.send('Emulation.setDeviceMetricsOverride',{width:1365,height:960,deviceScaleFactor:1,mobile:false});await b.screenshot(path.join(__dirname,'screenshots/home-completed.png'));
  for(const id of ids){await begin(id);await advance(120000);assert.equal(await run('MindOrbit.host.state'),'finished',id+' no-input finish');const result=await record(id);assert.equal(result.score,0,id+' no-input score');report.timeouts.push({id,score:result.score,outcome:result.outcome,durationMs:result.durationMs});console.log('TIMEOUT',id,result.outcome);}
  const before=await run('Object.values(MindOrbit.store.data.games).reduce((sum,g)=>sum+g.history.length,0)');
  await begin('A3');await b.click('.play-top button');assert.equal(await run('document.querySelector("dialog").open'),true);await advance(1000);await closeConfirmation('cancel');assert.equal(await run('MindOrbit.host.state'),'running');await b.click('.play-top button');await closeConfirmation('confirm');assert.equal(await run('MindOrbit.host.state'),'aborted');assert.equal(await run('Object.values(MindOrbit.store.data.games).reduce((sum,g)=>sum+g.history.length,0)'),before);report.checks.push('non-pausing exit cancel and confirmed abort');
  await route('/history');assert.ok(await run('document.querySelectorAll(".history-row").length')>=2);await route('/settings');await run('document.querySelector("select[aria-label=减弱动效]").focus()');await b.key('Home','Home',36);await b.key('ArrowDown','ArrowDown',40);await b.key('Enter','Enter',13);assert.equal(await run('document.documentElement.dataset.motion'),'on');
  await b.navigate('http://127.0.0.1:4173/#/history');assert.equal(await run('Object.values(MindOrbit.store.data.games).reduce((sum,g)=>sum+g.history.length,0)'),before);assert.equal(await run('document.documentElement.dataset.motion'),'on');report.checks.push('reload persists all sessions and preferences');
  assert.deepEqual(b.errors,[]);assert.ok(b.requests.every(url=>url.startsWith('http://127.0.0.1:4173/')));report.checks.push('no uncaught errors or external app requests');
  report.status='passed';fs.writeFileSync(path.join(__dirname,'chrome-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }catch(error){report.status='failed';report.error=error.stack;report.consoleErrors=b.errors;fs.writeFileSync(path.join(__dirname,'chrome-results.json'),JSON.stringify(report,null,2));await b.screenshot(path.join(__dirname,'screenshots/failure.png'));throw error;}finally{await b.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
