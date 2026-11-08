import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=resolve(process.argv[2]),root=join(repo,'benchmarks/janus-studio'),ev=join(root,'evidence');
const read=async n=>JSON.parse(await readFile(join(ev,n),'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
const scope=await read('final-source-scope.json');
for(const [file,hashes]of Object.entries(scope.sources)){
 assert.equal(sha(await readFile(join(repo,file))),hashes.final);
 assert.equal(sha(execFileSync('git',['show',scope.measuredEngineCommit+':'+file],{cwd:repo})),hashes.measured);
}
for(const [folder,manifest]of [['tools',await read('desktop-source-manifest.json')],['qualification-tools',await read('qualification-tools-manifest.json')]])
 for(const [name,hash]of Object.entries(manifest.tools))assert.equal(sha(await readFile(join(root,folder,name))),hash,`${folder}/${name}`);
let measuredFrames=0,matchingCaptures=0;const outcomes=[];
for(const name of ['desktop','buildings','scale100','mobile']){
 const summary=await read(name+'-paired-summary.json'),pairs=[];
 for(let round=1;round<=5;round++){
  const a=await read(`${name}-pair${round}-r187.json`),b=await read(`${name}-pair${round}-fork.json`);
  for(const run of [a,b]){
   assert.equal(run.result.frames,300);assert.equal(run.result.summaries.length,300);assert.ok(run.result.warmup>=120);
   assert.deepEqual(run.errors,[]);assert.deepEqual(run.logs,[]);assert.equal(run.result.glError,0);assert.equal(run.result.backend,'WebGL2');
   assert.ok(run.result.summaries.every(s=>s.draws>0&&s.triangles>0));assert.equal(run.result.pixels.length,3);assert.ok(run.result.pixels.every(p=>p.colored>0&&p.nonzeroAlpha>0));
   for(const metric of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs']){
    const values=run.result.summaries.map(x=>x[metric]).filter(Number.isFinite);
    for(const [key,p]of [['p50',.5],['p95',.95],['p99',.99]])near(pct(values,p),run.result.metrics[metric][key]);
   }
   if(name==='buildings'){assert.equal(run.result.models,45);assert.equal(run.result.retained,45);assert.equal(run.result.fullModels,20);assert.equal(run.result.hidden,0)}
   if(name==='mobile'){assert.deepEqual(run.config.viewport,{width:390,height:844});assert.equal(run.config.cpuRate,4)}
   measuredFrames+=300;
  }
  for(const key of ['browser','applicationSnapshot','protocol','data'])assert.deepEqual(a[key],b[key]);
  assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.pixels,b.result.pixels);matchingCaptures+=3;
  assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));
  if(a.protocol){assert.equal(a.protocol.engineSourceCommit,scope.measuredEngineCommit);for(const [f,h]of Object.entries(a.protocol.engine))assert.equal(h,scope.sources[f].measured)}
  pairs.push([a,b]);
 }
 const random=rng(20261107);
 for(const metric of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs']){
  const logs=pairs.map(([a,b])=>Math.log(b.result.metrics[metric].p95/a.result.metrics[metric].p95)),samples=[];
  for(let n=0;n<10000;n++){let sum=0;for(let k=0;k<5;k++)sum+=logs[Math.floor(random()*5)];samples.push(Math.exp(sum/5))}
  const ci=[pct(samples,.025),pct(samples,.975)],ratio=Math.exp(logs.reduce((a,b)=>a+b,0)/5);
  near(summary.stats[metric].geometricMeanRatio,ratio);near(summary.stats[metric].ratio95CI[0],ci[0]);near(summary.stats[metric].ratio95CI[1],ci[1]);
 }
 outcomes.push({case:name,improvementPercent:summary.stats.engineMs.improvementPercent,primaryTargetMet:summary.primaryTargetMet});
}
assert.ok(outcomes.some(x=>x.case==='desktop'&&x.primaryTargetMet));
const budget=await read('regression-budget.json');assert.equal(budget.passed,true);assert.equal(budget.cases.length,6);assert.ok(budget.cases.every(c=>c.budgetExcess95CI[1]<=0));
const stable=await read('stable-scene.json');assert.equal(stable.runs.length,15);
const bootstrapBudget=(pairs,random)=>{
 const samples=[];
 for(let n=0;n<10000;n++){let sum=0;for(let i=0;i<5;i++){const [a,b]=pairs[Math.floor(random()*5)];sum+=b-a-Math.max(.3,.05*a)}samples.push(sum/5)}
 return [pct(samples,.025),pct(samples,.975)];
};
const budgetRandom=rng(20261108);
for(const name of ['desktop','buildings','scale100','mobile']){
 const pairs=[];for(let i=1;i<=5;i++)pairs.push([(await read(`${name}-pair${i}-r187.json`)).result.metrics.engineMs.p95,(await read(`${name}-pair${i}-fork.json`)).result.metrics.engineMs.p95]);
 const ci=bootstrapBudget(pairs,budgetRandom),reported=budget.cases.find(c=>c.name===name).budgetExcess95CI;ci.forEach((x,i)=>near(x,reported[i]));
}
const stableRandom=rng(20261108);
for(const variant of ['fork','fork-default']){
 const pairs=Array.from({length:5},(_,i)=>['r187',variant].map(v=>stable.runs.find(r=>r.round===i+1&&r.variant===v).result.metrics.p95));
 const ci=bootstrapBudget(pairs,stableRandom),reported=budget.cases.find(c=>c.name==='stable1000-'+variant).budgetExcess95CI;ci.forEach((x,i)=>near(x,reported[i]));
}
for(let round=1;round<=5;round++){
 const runs=stable.runs.filter(x=>x.round===round);assert.equal(runs.length,3);
 for(const r of runs){assert.deepEqual(r.errors,[]);assert.equal(r.result.frames.length,300);assert.ok(r.result.warmup>=120);assert.deepEqual(r.result.pixels,runs[0].result.pixels);near(r.result.metrics.p95,pct(r.result.frames,.95))}
}
const qualification=await read('final-qualification.json');assert.equal(qualification.passed,true);
for(const n of qualification.testArtifacts){const x=await read(n);assert.equal(x.result.counts.failed,0);assert.deepEqual(x.errors,[]);assert.ok(x.tests.every(t=>!t.softSkips.length));}
const core=await read('qunit-chrome-final-core.json');assert.equal(core.result.counts.passed,1992);assert.equal(core.tests.filter(t=>t.name.includes('WebGLPrograms')&&t.status==='passed').length,10);
const build=await read('final-build-results.json');assert.equal(build.files.length,5);assert.deepEqual(build.warnings,[]);
assert.equal(build.files.filter(f=>!f.matchesPublished).length,1);assert.equal(build.files.find(f=>!f.matchesPublished).name,'three.module.js');
for(const v of ['r187','fork']){const x=await read('studio-original-assertions-'+v+'.json');assert.deepEqual(x.errors,[]);assert.equal(x.results.length,3);assert.ok(x.results.every(r=>r.status==='passed'))}
const life=await read('studio-correctness-lifetime.json');for(const v of life.variants){assert.ok(Object.values(v.graphicsResourcesAfterFullTeardown).every(x=>x.live===0));assert.equal(v.rendererOwnedCanvasSubscriptionsAfterFullTeardown.length,6);assert.ok(v.rendererOwnedCanvasSubscriptionsAfterFullTeardown.every(x=>x.live===0&&x.added===3&&x.removed===3))}
const edits=await read('interaction-diagnostics.json');assert.equal(edits.all120ExpectedOutputChecksPassed,true);const signatures=edits.variants.map(v=>v.interactions.rows.map(r=>[r.cycle,r.name,r.sha256]));assert.equal(signatures[0].length,60);assert.deepEqual(signatures[0],signatures[1]);
const dispose=await read('dispose-scaling.json');for(const x of dispose.runs){assert.equal(x.result.remainingPrograms,0);assert.equal(x.result.deleteProgramCalls,x.result.count);assert.equal(x.result.glError,0);if(x.variant==='fork')assert.equal(x.result.scannedElements,0)}
for(const file of await readdir(ev)){const data=await readFile(join(ev,file),'utf8');assert.ok(!/\/Users\/|\/private\/tmp\/|fixture-signature|eyJhbGci/.test(data),'Private material in '+file)}
const goal=JSON.parse(await readFile(join(root,'goal.json'),'utf8'));assert.equal(goal.status,'complete');assert.ok(goal.milestones.every(x=>x.state==='complete'));
console.log(JSON.stringify({passed:true,measuredFrames,matchingCaptures,regressionComparisons:budget.cases.length,outcomes,limitsAcknowledged:goal.currentProgress.remainingLimits},null,2));
