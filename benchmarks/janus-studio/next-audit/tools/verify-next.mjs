import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=resolve(process.argv[2]),root=join(repo,'benchmarks/janus-studio/next-audit'),ev=join(root,'evidence');
const read=async name=>JSON.parse(await readFile(join(ev,name),'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const pct=(x,p)=>[...x].sort((a,b)=>a-b)[Math.ceil(x.length*p)-1],near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`),rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
const manifest=await read('tools-manifest.json');for(const [name,hash]of Object.entries(manifest.tools))assert.equal(sha(await readFile(join(root,'tools',name))),hash,name);
const qualification=await read('qualification.json');assert.equal(sha(await readFile(join(repo,'src/renderers/WebGLRenderer.js'))),qualification.sources.c09.rendererSha256);
for(const value of Object.values(qualification.sources))assert.equal(sha(execFileSync('git',['show',value.commit+':src/renderers/WebGLRenderer.js'],{cwd:repo})),value.rendererSha256);
let frames=0,captures=0,wholeSnapshot;const results=[];
for(const [stage,scene]of [['e02-frozen','studio'],['e02-frozen','buildings'],['c09','studio']]){
 const summary=await read(`${stage}-${scene}-summary.json`),rounds=summary.rounds.length,pairs=[];assert.ok(rounds===5||rounds===10);
 for(let round=1;round<=rounds;round++){
  const a=await read(`${stage}-${scene}-timing-pair${round}-control.json`),b=await read(`${stage}-${scene}-timing-pair${round}-candidate.json`);
  for(const r of [a,b]){
   assert.equal(r.result.frames,300);assert.equal(r.result.warmup,120);assert.equal(r.result.summaries.length,300);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[]);assert.equal(r.result.glError,0);assert.equal(r.result.backend,'WebGL2');assert.ok(!/software|swiftshader|llvmpipe/i.test(r.result.device));
   assert.equal(r.result.pixels.length,3);assert.ok(r.result.pixels.every(p=>p.colored>0&&p.nonzeroAlpha>0));assert.ok(r.result.summaries.every(s=>s.draws>0&&s.triangles>0));
   for(const metric of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs']){const samples=r.result.summaries.map(s=>s[metric]).filter(Number.isFinite);for(const [k,p]of [['p50',.5],['p95',.95],['p99',.99]])near(pct(samples,p),r.result.metrics[metric][k])}
   if(scene==='buildings'){assert.equal(r.result.models,45);assert.equal(r.result.fullModels,20);assert.equal(r.result.retained,45);assert.equal(r.result.hidden,0);assert.equal(r.picks.visiblePick,true)}
   for(const [name,hash]of Object.entries(r.protocol.tools))assert.equal(sha(await readFile(join(root,'tools',name))),hash);
   for(const variant of Object.values(r.protocol.engine))for(const [file,hash]of Object.entries(variant.sources))assert.equal(sha(execFileSync('git',['show',variant.ref+':'+file],{cwd:repo})),hash);
   assert.equal(r.protocol.cacheBudgetBothVariants,16);wholeSnapshot??=r.protocol.applicationSnapshot;assert.deepEqual(r.protocol.applicationSnapshot,wholeSnapshot);frames+=300;
  }
  for(const key of ['applicationSnapshot','protocol','data','browser'])assert.deepEqual(a[key],b[key]);assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.pixels,b.result.pixels);captures+=3;
  assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));pairs.push([a,b]);
 }
 const random=rng(20261108);
 for(const metric of ['engineMs','frameIntervalMs']){const logs=pairs.map(([a,b])=>Math.log(b.result.metrics[metric].p95/a.result.metrics[metric].p95)),samples=[];for(let n=0;n<10000;n++){let sum=0;for(let k=0;k<rounds;k++)sum+=logs[Math.floor(random()*rounds)];samples.push(Math.exp(sum/rounds))}const ci=[pct(samples,.025),pct(samples,.975)];ci.forEach((x,i)=>near(x,summary.stats[metric].ratio95CI[i]));near(100*(1-Math.exp(logs.reduce((a,b)=>a+b,0)/rounds)),summary.stats[metric].improvementPercent)}
 const randomBudget=rng(20261109),excess=pairs.map(([a,b])=>b.result.metrics.engineMs.p95-a.result.metrics.engineMs.p95-Math.max(.3,.05*a.result.metrics.engineMs.p95)),samples=[];
 for(let n=0;n<10000;n++){let sum=0;for(let k=0;k<rounds;k++)sum+=excess[Math.floor(randomBudget()*rounds)];samples.push(sum/rounds)}const ci=[pct(samples,.025),pct(samples,.975)];ci.forEach((x,i)=>near(x,summary.budget.excess95CI[i]));const status=ci[1]<=0?'pass':ci[0]>0?'regression':'unqualified';assert.equal(summary.budget.status,status);assert.notEqual(status,'regression','Reproducible budget breach');results.push({stage,scene,rounds,budget:status,improvementPercent:summary.stats.engineMs.improvementPercent});
 }
for(const browser of ['chrome','firefox','webkit']){const d=await read(`qunit-${browser}-c09-core.json`);assert.equal(d.result.counts.passed,205);assert.equal(d.result.counts.failed,0);assert.equal(d.result.counts.skipped,0);assert.deepEqual(d.errors,[]);assert.ok(d.tests.every(t=>!t.softSkips.length));assert.equal(d.tests.filter(t=>t.name.includes('WebGLVisibility')&&t.status==='passed').length,3);assert.equal(d.tests.filter(t=>t.name.includes('WebGLMaterialLifetime')&&t.status==='passed').length,3)}
const core=await read('qunit-chrome-next-final-core.json'),addons=await read('qunit-chrome-next-final-addons.json');assert.equal(core.result.counts.passed,1998);assert.equal(core.result.counts.failed,0);assert.equal(addons.result.counts.passed,145);assert.equal(addons.result.counts.failed,0);
assert.equal((await read('qunit-chrome-before-core.json')).result.counts.failed,1);assert.equal((await read('qunit-chrome-before-c09-core.json')).result.counts.failed,3);
const build=await read('build-results.json');assert.equal(build.files.length,5);assert.deepEqual(build.warnings,[]);assert.deepEqual(build.files.filter(f=>!f.matchesPublished).map(f=>f.name),['three.module.js']);
const hiddenA=(await read('engine-hidden-upload-control.json')).result,hiddenB=(await read('engine-hidden-upload-candidate.json')).result;assert.equal(hiddenA.logicalPayloadBytes,35389440);assert.equal(hiddenB.logicalPayloadBytes,0);for(const r of [hiddenA,hiddenB]){assert.equal(r.drawsHidden,1);assert.equal(r.drawsRevealed,129);assert.equal(r.glError,0);assert.deepEqual(r.pixel,[0,255,0,255])}
const gcA=(await read('engine-lifetime-gc-control.json')).result,gcB=(await read('engine-lifetime-gc-candidate.json')).result;assert.equal(gcA.disposedRendererStillReachable,true);assert.equal(gcB.disposedRendererStillReachable,false);assert.equal(gcA.retainedMaterialDisposeListeners,1);assert.equal(gcB.retainedMaterialDisposeListeners,0);assert.equal(gcA.unusedMaterialStillReachable,false);assert.equal(gcB.unusedMaterialStillReachable,false);
const behavior=await read('janus-behavior.json');assert.deepEqual(behavior.variants[0].hashes,behavior.variants[1].hashes);assert.deepEqual(behavior.variants[0].comparisonHashes,behavior.variants[1].comparisonHashes);for(const r of behavior.variants){assert.equal(r.picks.length,100);assert.equal(r.comparisonHashes.length,5);assert.ok(r.comparisonMaterialSubscriptions.every(x=>x.after===0));assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[])}
for(const name of await readdir(ev)){if(!name.endsWith('.json'))continue;const body=await readFile(join(ev,name),'utf8');assert.ok(!/\/Users\/|\/private\/tmp\/|fixture-signature|eyJhbGci/.test(body),'Private data in '+name)}
console.log(JSON.stringify({verified:true,allCpuBudgetsQualified:results.every(x=>x.budget==='pass'),frames,matchedPairedCaptures:captures,applicationSnapshot:wholeSnapshot,results},null,2));
