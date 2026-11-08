import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=resolve(process.argv[2]),root=join(repo,'benchmarks/janus-studio/binding-cleanup'),ev=join(root,'evidence');
const read=async n=>JSON.parse(await readFile(join(ev,n))),sha=x=>createHash('sha256').update(x).digest('hex');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`),pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1],rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
const summary=await read('binding-buildings-summary.json'),declaration=await read('campaign-declaration.json'),qualification=await read('qualification.json');
assert.equal(summary.pairedRounds,5);assert.equal(declaration.pairedRounds,5);
const manifest=await read('tools-manifest.json');for(const [path,hash]of Object.entries(manifest.tools))assert.equal(sha(await readFile(join(repo,path))),hash,path);
const pairs=[];let frames=0,captures=0;
for(let i=1;i<=5;i++){
 const records=await Promise.all(['control','candidate'].map(v=>read(`binding-buildings-timing-pair${i}-${v}.json`)));
 for(const r of records){
  assert.deepEqual(r.protocol,summary.protocol);assert.equal(r.result.frames,300);assert.equal(r.result.warmup,120);assert.equal(r.result.summaries.length,300);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[]);assert.equal(r.result.glError,0);
  assert.equal(r.result.backend,'WebGL2');assert.ok(!/software|swiftshader|llvmpipe/i.test(r.result.device));
  assert.equal(r.result.models,45);assert.equal(r.result.fullModels,20);assert.equal(r.result.retained,45);assert.equal(r.result.hidden,0);assert.equal(r.picks.visiblePick,true);
  assert.equal(r.result.pixels.length,3);assert.ok(r.result.pixels.every(x=>x.colored>0&&x.nonzeroAlpha>0));assert.ok(r.result.summaries.every(s=>s.draws>0&&s.triangles>0));
  for(const name of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs'])for(const [key,p]of [['p50',.5],['p95',.95],['p99',.99]])near(pct(r.result.summaries.map(s=>s[name]).filter(Number.isFinite),p),r.result.metrics[name][key]);
  for(const [name,hash]of Object.entries(r.protocol.tools))assert.equal(sha(await readFile(join(repo,'benchmarks/janus-studio/next-audit/tools',name))),hash);
  for(const variant of Object.values(r.protocol.engine))for(const [path,hash]of Object.entries(variant.sources))assert.equal(sha(execFileSync('git',['show',variant.ref+':'+path],{cwd:repo})),hash);
  assert.equal(r.protocol.cacheBudgetBothVariants,16);frames+=300;
 }
 const [a,b]=records;for(const key of ['applicationSnapshot','data','browser'])assert.deepEqual(a[key],b[key]);assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.pixels,b.result.pixels);assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));pairs.push(records);captures+=3;
}
assert.equal(summary.protocol.engine.control.ref,declaration.control);assert.equal(summary.protocol.engine.candidate.ref,declaration.candidate);assert.equal(summary.protocol.applicationSnapshot.sha256,declaration.applicationSnapshotSha256);
const resample=(logs,random)=>{const samples=[];for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<logs.length;j++)sum+=logs[Math.floor(random()*logs.length)];samples.push(Math.exp(sum/logs.length))}return [pct(samples,.025),pct(samples,.975)]};
const random=rng(20261108);
for(const name of ['engineMs','frameIntervalMs']){
 const logs=pairs.map(([a,b])=>Math.log(b.result.metrics[name].p95/a.result.metrics[name].p95)),ci=resample(logs,random);ci.forEach((v,i)=>near(v,summary.stats[name].ratio95CI[i]));near(100*(1-Math.exp(logs.reduce((a,b)=>a+b,0)/logs.length)),summary.stats[name].improvementPercent);
}
const logs=pairs.map(([a,b])=>Math.log(b.result.metrics.engineMs.p50/a.result.metrics.engineMs.p50)),ci=resample(logs,rng(20261110));ci.forEach((v,i)=>near(v,summary.secondaryMedianCpu.ratio95CI[i]));near(100*(1-Math.exp(logs.reduce((a,b)=>a+b,0)/logs.length)),summary.secondaryMedianCpu.improvementPercent);
const budgetRandom=rng(20261109),excess=pairs.map(([a,b])=>b.result.metrics.engineMs.p95-a.result.metrics.engineMs.p95-Math.max(.3,.05*a.result.metrics.engineMs.p95)),samples=[];
for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<5;j++)sum+=excess[Math.floor(budgetRandom()*5)];samples.push(sum/5)}
[pct(samples,.025),pct(samples,.975)].forEach((v,i)=>near(v,summary.budget.excess95CI[i]));assert.equal(summary.budget.status,'pass');assert.ok(pct(samples,.975)<=0);
for(const [name,record]of Object.entries(qualification.units)){
 const r=await read(name);assert.equal(sha(await readFile(join(ev,name))),record.sha256);assert.equal(r.result.counts.failed,0);assert.equal(r.result.counts.passed,record.passed);assert.equal(r.result.counts.skipped,0);assert.deepEqual(r.errors,[]);assert.ok(r.tests.every(t=>!t.softSkips.length));
}
for(const [path,hash]of Object.entries(qualification.candidateSources))assert.equal(sha(execFileSync('git',['show',declaration.candidate+':'+path],{cwd:repo})),hash);
const build=await read('build-results.json');assert.equal(build.files.length,5);assert.deepEqual(build.warnings,[]);
const probe=await read('binding-probe.json');assert.equal(probe.cases.length,3);
for(const variant of ['control','candidate'])assert.equal(sha(execFileSync('git',['show',probe.sources[variant].commit+':src/renderers/webgl/WebGLBindingStates.js'],{cwd:repo})),probe.sources[variant].sha256);
for(const c of probe.cases){assert.equal(c.pairs.length,5);for(const p of c.pairs){assert.deepEqual(p.control.programIdReads,{populated:c.unrelatedGeometryCount+3,empty:c.unrelatedGeometryCount+1});assert.deepEqual(p.candidate.programIdReads,{populated:1,empty:1});for(const v of ['control','candidate']){assert.equal(p[v].cycles,256);assert.ok(p[v].elapsedMs>0);assert.equal(p[v].lifecycle.live,0);assert.equal(p[v].lifecycle.created,p[v].lifecycle.deleted);assert.equal(p[v].lifecycle.unrelatedBindingsPreserved,true)}}for(const v of ['control','candidate'])near(pct(c.pairs.map(p=>p[v].elapsedMs/256),.5),c.medianCycleMs[v])}

const failure=await read('current-source-status.json');assert.equal(failure.qualified,false);assert.equal(failure.nanBoundingSphereErrors,154);
for(const name of await readdir(ev)){if(!name.endsWith('.json'))continue;assert.ok(!/\/Users\/|\/private\/tmp\/|fixture-signature|eyJhbGci/.test(await readFile(join(ev,name),'utf8')),'Private data in '+name)}
console.log(JSON.stringify({verified:true,measuredFrames:frames,matchedPairedCaptures:captures,p50CpuImprovementPercent:summary.secondaryMedianCpu.improvementPercent,p95CpuImprovementPercent:summary.stats.engineMs.improvementPercent,p95FrameIntervalImprovementPercent:summary.stats.frameIntervalMs.improvementPercent,cpuBudget:summary.budget.status,currentApplicationQualified:false},null,2));
