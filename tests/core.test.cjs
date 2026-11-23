'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const context=vm.createContext({window:{},crypto:require('node:crypto').webcrypto,console});
for(const file of ['core/random','data/catalog','core/scoring','core/storage'])vm.runInContext(fs.readFileSync(path.join(root,'js',file+'.js'),'utf8'),context,{filename:file});
const M=context.window.MindOrbit;
for(const id of Object.keys(M.catalog))M.registerGame({id,createSession(){}});
const backend=(initial=null)=>{const map=new Map(initial===null?[]:[[M.storage.KEY,initial]]);return{map,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};};
const record=(id,score=100,version='1')=>({sessionId:'session-'+id,gameId:'B1',rulesVersion:version,contentVersion:'1',outcome:'completed',score,metrics:{correct:score/10,missed:0,meanCorrectMs:score===0?null:500,trials:Array.from({length:10},(_,index)=>({id:'fixture-'+index,answer:0,correct:index<score/10,rtMs:500,explanation:'Fixture answer',stimulus:'Fixture question'}))},completedAt:'2026-11-22T09:00:00.000Z',localDay:'2026-11-22',utcOffsetMinutes:480,durationMs:1000,inputMode:'pointer',rngSeed:'sample'});
const json=value=>JSON.parse(JSON.stringify(value));
test('registry covers eighteen unique IDs and rejects duplicates',()=>{assert.equal(Object.keys(M.games).length,18);assert.throws(()=>M.registerGame({id:'A1'}));for(const module of M.modules)assert.equal(Object.keys(M.games).filter(id=>id[0]===module.id).length,3);});
test('all twenty specification scoring examples',()=>{
 const examples=[['A1',{maxCorrectCells:6},67],['A2',{maxLength:6},57],['A3',{matchedPairs:8,moves:12,durationMs:60000},67],['A3',{matchedPairs:4,moves:8,durationMs:120000},18],['B1',{correct:8},80],['B2',{correct:6},75],['B3',{correct:7},88],['C1',{correct:5},63],['C2',{correct:6},75],['C3',{correct:4},50],['D1',{reactionTimes:[300,300,300,300,300],meanRtMs:300,penalties:1},75],['D2',{correct:9},75],['D3',{hits:12,errors:2},76],['E1',{correct:18},78],['E2',{completed:true,durationMs:55000,errors:2},64],['E3',{correct:6,meanCorrectMs:5000},91],['E3',{correct:3,meanCorrectMs:5000},46],['F1',{correct:8},80],['F2',{correct:3},60],['F3',{correct:6},75]];
 for(const[id,metrics,expected]of examples)assert.equal(M.scoring.game(id,metrics),expected,id);
});
test('all games zero, maximum and finite normalization boundaries',()=>{
 const pairs={A1:[{maxCorrectCells:0},{maxCorrectCells:8}],A2:[{maxLength:0},{maxLength:9}],A3:[{matchedPairs:0,moves:0,durationMs:120000},{matchedPairs:8,moves:8,durationMs:30000}],D1:[{reactionTimes:[],meanRtMs:null,penalties:10},{reactionTimes:[200,200,200,200,200],meanRtMs:200,penalties:0}],D3:[{hits:0,errors:20},{hits:15,errors:0}],E2:[{completed:false,durationMs:120000,errors:0},{completed:true,durationMs:25000,errors:0}],E3:[{correct:0,meanCorrectMs:null},{correct:6,meanCorrectMs:2000}]};
 for(const[id,n]of Object.entries(M.scoring.denominators))pairs[id]=[{correct:0},{correct:n}];
 for(const[id,[zero,full]]of Object.entries(pairs)){assert.equal(M.scoring.game(id,zero),0,id);assert.equal(M.scoring.game(id,full),100,id);}
 for(const value of [-100,0,.49,.5,45.49999999999999,99.5,100,1000])assert.ok(Number.isInteger(M.scoring.normalize(value))&&M.scoring.normalize(value)>=0&&M.scoring.normalize(value)<=100);
 assert.equal(M.scoring.normalize(45.49999999999999),46);for(const value of [NaN,Infinity,-Infinity])assert.throws(()=>M.scoring.normalize(value));assert.throws(()=>M.scoring.speed(null,1,2));
});
test('favorites persist, reject malformed IDs and do not alter training counts',()=>{
 const b=backend(),s=M.storage.create(b),ids=['A1','E2'];
 assert.equal(s.settings({favorites:ids}),true);ids.push('F3');
 assert.deepEqual(json(s.data.settings.favorites),['A1','E2']);
 assert.deepEqual(json(M.storage.create(b).data.settings.favorites),['A1','E2']);
 assert.equal(Object.keys(s.data.games).length,0);assert.equal(s.data.streak.totalDays,0);
 for(const favorites of [null,'A1',['A1','A1'],['constructor'],['__proto__'],['Z1'],[1]]){
  const before=JSON.stringify(s.data);assert.throws(()=>s.settings({favorites}),/设置无效/);assert.equal(JSON.stringify(s.data),before);
  const invalid={...json(s.data),settings:{...s.data.settings,favorites}};const source=JSON.stringify(invalid),bad=backend(source),restored=M.storage.create(bad);
  assert.equal(restored.persistent,false);assert.equal(bad.getItem(M.storage.KEY),source);
 }
 s.settings({favorites:[]});assert.deepEqual(json(M.storage.create(b).data.settings.favorites),[]);
 s.reset();assert.equal(s.data.settings.favorites,undefined);
});
test('favorites follow quota and conflict protections without overwriting snapshots',()=>{
 const b=backend(),one=M.storage.create(b),two=M.storage.create(b);one.settings({favorites:['A1']});const old=b.getItem(M.storage.KEY);
 assert.equal(two.settings({favorites:['B1']}),false);assert.equal(b.getItem(M.storage.KEY),old);
 b.setItem=()=>{throw new Error('quota');};assert.equal(one.settings({favorites:['E2']}),false);assert.equal(b.getItem(M.storage.KEY),old);
 assert.deepEqual(json(one.data.settings.favorites),['E2']);
});
test('growth timeline leaves missing coverage null and rebuilds equal-weight current scores',()=>{
 const data={games:{}};assert.deepEqual(json(M.scoring.timeline(data)),[]);
 const sample=(id,day,score,version='1',hour='09')=>({gameId:id,localDay:day,completedAt:day+'T'+hour+':00:00Z',score,rulesVersion:version});
 data.games.A1={history:[sample('A1','2026-11-20',80)]};
 assert.deepEqual(json(M.scoring.timeline(data)),[{day:'2026-11-20',score:null,coverage:1}]);
 for(const id of Object.keys(M.games))data.games[id]={history:[sample(id,'2026-11-21',50)]};
 data.games.A1.history.push(sample('A1','2026-11-22',100));
 let points=M.scoring.timeline(data);assert.equal(points.length,2);assert.equal(points[0].score,50);assert.equal(points[1].score,M.scoring.portrait(data).score);
 assert.ok(Math.abs(points[1].score-(50+25/18))<1e-8);
 data.games.A1.history.push(sample('A1','2026-11-23',100,'0'));
 const unchanged=JSON.stringify(data);points=M.scoring.timeline(data);assert.equal(points.length,2);assert.equal(JSON.stringify(data),unchanged);
});
test('growth timeline sorts chronology and takes the latest five per game at each day end',()=>{
 const data={games:{}};
 for(const id of Object.keys(M.games))data.games[id]={history:[{gameId:id,localDay:'2026-11-01',completedAt:'2026-11-01T08:00:00Z',score:100,rulesVersion:'1'}]};
 for(let i=0;i<7;i++)data.games.A1.history.push({gameId:'A1',localDay:'2026-11-02',completedAt:`2026-11-02T0${i}:00:00Z`,score:i*10,rulesVersion:'1'});
 data.games.A1.history.reverse();const points=M.scoring.timeline(data);
 assert.equal(points.length,2);assert.equal(points[0].score,100);assert.ok(Math.abs(points[1].score-(100-60/18))<1e-8);
 assert.equal(points[1].coverage,18);
});
test('rank boundaries use unrounded values',()=>{for(const[value,name]of [[0,'星尘'],[19.999,'星尘'],[20,'卫星'],[34.999,'卫星'],[35,'行星'],[50,'恒星'],[65,'星云'],[80,'星系'],[90,'黑洞'],[100,'黑洞']])assert.equal(M.scoring.rank(value),name);assert.equal(M.scoring.rank(null),null);});
test('seeded shuffle is reproducible and preserves multiplicities',()=>{const a=M.random('test'),b=M.random('test');for(let i=0;i<100;i++)assert.deepEqual(json(a.shuffle([0,0,1,2,3])),json(b.shuffle([0,0,1,2,3])));const shuffled=M.random('other').shuffle([1,2,3,4]);assert.deepEqual(json(shuffled.sort()),[1,2,3,4]);});
test('portrait never imputes missing games, isolates rules, weights games equally',()=>{const data=M.storage.fresh();data.games.A1={history:[60,80].map(score=>({score,rulesVersion:'1'}))};data.games.A2={history:[{score:50,rulesVersion:'1'},{score:100,rulesVersion:'0'}]};data.games.A3={history:[{score:90,rulesVersion:'1'}]};let p=M.scoring.portrait(data);assert.equal(p.modules[0].score,70);assert.equal(p.coverage,3);assert.equal(p.score,null);data.games.A1.history.push(...[10,20,30,40,50,60].map(score=>({score,rulesVersion:'1'})));p=M.scoring.portrait(data);assert.equal(p.games.A1.score,40);assert.equal(p.modules[0].score,60);for(const id of Object.keys(M.games))data.games[id]={history:[{score:90,rulesVersion:'1'}]};assert.equal(M.scoring.portrait(data).rank,'黑洞');});
test('calendar streak handles same day, gaps, rollback, leap day and DST dates',()=>{let s=M.storage.fresh().streak;const next=day=>s=M.storage.advanceStreak(s,day).streak;next('2024-02-28');next('2024-02-28');assert.equal(s.totalDays,1);next('2024-02-29');next('2024-03-01');assert.equal(s.current,3);next('2024-03-03');assert.equal(s.current,1);assert.equal(s.longest,3);assert.equal(M.storage.advanceStreak(s,'2024-03-02').rollback,true);assert.deepEqual(json(M.storage.advanceStreak(s,'2024-03-02').streak),json(s));assert.equal(M.storage.dayNumber('2026-03-09')-M.storage.dayNumber('2026-03-08'),1);assert.throws(()=>M.storage.dayNumber('2026-02-29'));});
test('save, reload, duplicate gate, best score and bounded history',()=>{const b=backend(),s=M.storage.create(b);assert.equal(s.save(record(0)).recordType,'first');assert.equal(s.save(record(0)).duplicate,true);for(let i=1;i<=101;i++)s.save(record(i,20));const game=s.data.games.B1;assert.equal(game.history.length,100);assert.equal(game.statsByRulesVersion['1'].completedCount,102);assert.equal(game.statsByRulesVersion['1'].bestScore,100);assert.equal(game.history.some(item=>item.sessionId==='session-0'),false);assert.equal(s.data.streak.totalDays,1);const restored=M.storage.create(b);assert.equal(restored.persistent,true);assert.equal(restored.data.games.B1.statsByRulesVersion['1'].completedCount,102);});
test('record ties and rules-version summaries remain separate',()=>{const s=M.storage.create(backend());assert.equal(s.save(record(1,20)).recordType,'first');assert.equal(s.save(record(2,20)).recordType,'equal');assert.equal(s.save(record(3,30)).recordType,'new');s.save(record(4,100,'2'));assert.equal(s.data.games.B1.statsByRulesVersion['1'].completedCount,3);assert.equal(s.data.games.B1.statsByRulesVersion['2'].completedCount,1);assert.equal(M.scoring.portrait(s.data).games.B1.samples,3);});
test('corrupt or newer schemas are preserved, memory sessions still work',()=>{for(const raw of ['{bad',JSON.stringify({...M.storage.fresh(),schemaVersion:2}),JSON.stringify({...M.storage.fresh(),revision:-1})]){const b=backend(raw),s=M.storage.create(b);assert.equal(s.persistent,false);assert.equal(s.save(record(1)).saved,false);assert.equal(b.getItem(M.storage.KEY),raw);assert.equal(s.data.games.B1.history.length,1);}});
test('quota failure keeps previous persistent root and current memory result',()=>{const b=backend(),s=M.storage.create(b);s.save(record(1));const old=b.getItem(M.storage.KEY);b.setItem=()=>{throw new Error('quota');};const result=s.save(record(2));assert.equal(result.saved,false);assert.equal(b.getItem(M.storage.KEY),old);assert.equal(s.data.games.B1.history.length,2);});
test('conflicting writes are detected, unknown data not overwritten',()=>{const b=backend(),one=M.storage.create(b),two=M.storage.create(b);one.save(record(1));const snapshot=b.getItem(M.storage.KEY);assert.equal(two.save(record(2)).saved,false);assert.equal(b.getItem(M.storage.KEY),snapshot);});
test('unavailable storage degrades and reset never clears other app keys',()=>{const broken={getItem(){throw new Error();},setItem(){throw new Error();},removeItem(){throw new Error();}};const s=M.storage.create(broken);assert.equal(s.save(record(1)).saved,false);const b=backend();b.setItem('other-app','keep');const valid=M.storage.create(b);valid.save(record(1));valid.reset();assert.equal(b.getItem('other-app'),'keep');assert.equal(Object.keys(valid.data.games).length,0);});
test('schema rejects out-of-range metrics, scores, times and unsafe nested values',()=>{const r=record(1);for(const patch of [{score:101},{durationMs:-1},{utcOffsetMinutes:9999},{localDay:'2026-02-31'},{inputMode:'mouse'},{metrics:{correct:11}},{metrics:{correct:10,trials:[NaN]}}])assert.equal(M.storage.validRecord({...r,...patch},'B1'),false);assert.equal(M.storage.validRecord({...r,score:30},'B1'),false);for(const id of ['constructor','__proto__','unknown'])assert.equal(M.storage.validRecord({...r,gameId:id,rulesVersion:'2'},id),false);assert.equal(M.storage.validateMetrics('E3',{correct:0,meanCorrectMs:0}),false);assert.equal(M.storage.validateMetrics('D1',{reactionTimes:[],meanRtMs:0,medianRtMs:null,penalties:0,attempts:0}),false);});
