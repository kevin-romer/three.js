import {readFile,readdir,mkdtemp,rm,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const repo=resolve(process.argv[2]),root=join(repo,'benchmarks/janus-studio/matrix-serialization'),ev=join(root,'evidence');
const read=async n=>JSON.parse(await readFile(join(ev,n))),sha=x=>createHash('sha256').update(x).digest('hex');
const near=(a,b)=>assert.ok(Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7,`${a} != ${b}`),pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const summary=await read('matrix-buildings-summary.json'),declaration=await read('campaign-declaration.json'),qualification=await read('qualification.json'),manifest=await read('tools-manifest.json');
assert.equal(summary.pairedRounds,20);assert.equal(declaration.pairedRounds,20);assert.equal(declaration.framesPerRun,300);assert.equal(declaration.warmupPerRun,120);
assert.equal(summary.protocol.version,6);assert.equal(summary.protocol.cpuTimeDomain,'threadTicks');assert.equal(summary.protocol.primaryMetric,'threadCpu.scriptMs/frames');assert.equal(summary.protocol.cacheBudgetBothVariants,16);
for(const [path,hash]of Object.entries(manifest.tools))assert.equal(sha(await readFile(join(repo,path))),hash,path);
for(const [name,hash]of Object.entries(summary.protocol.tools))assert.equal(sha(await readFile(join(repo,manifest.protocolToolPaths[name]))),hash,name);
for(const variant of Object.values(summary.protocol.engine))for(const [path,hash]of Object.entries(variant.sources))assert.equal(sha(execFileSync('git',['show',variant.ref+':'+path],{cwd:repo})),hash);
assert.equal(summary.protocol.engine.control.ref,declaration.control);assert.equal(summary.protocol.engine.candidate.ref,declaration.candidate);assert.equal(summary.protocol.applicationSnapshot.sha256,declaration.applicationSnapshotSha256);assert.equal(summary.protocol.applicationSnapshot.files,317);
let frames=0,captures=0;const pairs=[];
for(let i=1;i<=20;i++){
 const records=await Promise.all(['control','candidate'].map(v=>read(`matrix-buildings-timing-pair${i}-${v}.json`)));
 for(const [index,r]of records.entries()){
  assert.equal(r.variant,['control','candidate'][index]);assert.deepEqual(r.protocol,summary.protocol);assert.equal(r.result.frames,300);assert.equal(r.result.warmup,120);assert.equal(r.result.summaries.length,300);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[]);assert.equal(r.result.glError,0);
  assert.equal(r.result.backend,'WebGL2');assert.ok(!/software|swiftshader|llvmpipe/i.test(r.result.device));
  assert.equal(r.result.models,45);assert.equal(r.result.fullModels,20);assert.equal(r.result.retained,45);assert.equal(r.result.hidden,0);assert.equal(r.picks.visiblePick,true);
  assert.equal(r.result.pixels.length,3);assert.ok(r.result.pixels.every(x=>x.colored>0&&x.nonzeroAlpha>0));assert.ok(r.result.summaries.every(s=>s.draws===49&&s.triangles>0&&s.renderCalls===3));
  for(const name of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs'])for(const [key,p]of [['p50',.5],['p95',.95],['p99',.99]])near(pct(r.result.summaries.map(s=>s[name]).filter(Number.isFinite),p),r.result.metrics[name][key]);
  const cpu=r.result.threadCpu;assert.equal(cpu.timeDomain,'threadTicks');assert.equal(cpu.frames,300);
  for(const name of ['script','task']){assert.ok(cpu[name+'AfterSec']>cpu[name+'BeforeSec']);near((cpu[name+'AfterSec']-cpu[name+'BeforeSec'])*1000,cpu[name+'Ms']);assert.ok(cpu[name+'Ms']>0)}
  assert.ok(cpu.taskMs>=cpu.scriptMs);frames+=300;
 }
 const [a,b]=records;for(const key of ['applicationSnapshot','data','browser'])assert.deepEqual(a[key],b[key]);assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.pixels,b.result.pixels);assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));
 if(pairs.length){for(const key of ['applicationSnapshot','data','browser'])assert.deepEqual(a[key],pairs[0][0][key]);assert.equal(a.result.device,pairs[0][0].result.device)}pairs.push(records);captures+=3;
}
const scratch=await mkdtemp(join(tmpdir(),'three-matrix-verification-'));
try{
 for(let i=1;i<=20;i++)for(const v of ['control','candidate']){const name=`matrix-buildings-timing-pair${i}-${v}.json`;await copyFile(join(ev,name),join(scratch,name))}
 execFileSync(process.execPath,[join(root,'tools/analyze-cpu.mjs'),scratch],{stdio:'pipe'});
 assert.deepEqual(JSON.parse(await readFile(join(scratch,'matrix-buildings-summary.json'))),summary,'Recomputed summary differs');
}finally{await rm(scratch,{recursive:true,force:true})}
assert.ok(summary.threadCpu.stats.scriptMs.improvement95CI[0]>0);assert.equal(summary.budget.status,'pass');assert.ok(summary.budget.excess95CI[1]<=0);assert.deepEqual(summary.shippingCriterion,{primaryImprovement:true,rendererBudget:'pass',qualified:true});
for(const [name,record]of Object.entries(qualification.units)){
 const r=await read(name);assert.equal(sha(await readFile(join(ev,name))),record.sha256);assert.equal(r.result.counts.failed,0);assert.equal(r.result.counts.passed,record.passed);assert.equal(r.result.counts.todo,record.todo);assert.equal(r.result.counts.skipped,0);assert.deepEqual(r.errors,[]);assert.ok(r.tests.every(t=>!t.softSkips.length));
 if(name.includes('matrix-pass'))assert.equal(record.passed,51);else if(name.includes('matrix-webgl'))assert.equal(record.passed,217);else if(name.includes('addons')){assert.equal(record.passed,145);assert.deepEqual(r.missing,['test/unit/texture.test'])}else{assert.equal(record.passed,2013);assert.equal(record.todo,1)}
}
assert.equal(Object.keys(qualification.units).length,8);assert.equal(qualification.candidate,declaration.candidate);
for(const [path,hash]of Object.entries(qualification.candidateSources))assert.equal(sha(execFileSync('git',['show',declaration.candidate+':'+path],{cwd:repo})),hash);
for(const [name,record]of Object.entries(qualification.commands)){assert.equal(record.exitCode,0);const log={coreLint:'matrix-lint-core.log',testLint:'matrix-lint-test.log',build:'matrix-build.log'}[name];assert.equal(sha(await readFile(join(ev,log))),record.logSha256)}
const build=await read('build-results.json');assert.equal(build.files.length,5);assert.deepEqual(build.warnings,[]);assert.deepEqual(build.files.filter(f=>!f.matchesPublished).map(f=>f.name),['three.core.js','three.module.js']);
const previousBuild=JSON.parse(await readFile(join(repo,'benchmarks/janus-studio/parameter-reuse/evidence/build-results.json')));assert.deepEqual(build.files.filter(f=>f.sha256!==previousBuild.files.find(p=>p.name===f.name).sha256).map(f=>f.name),['three.core.js']);
const equiv=await read('matrix-equivalence.json');assert.equal(equiv.comparisons,10000);assert.equal(equiv.cases,5000);assert.equal(equiv.exceptions,50);assert.equal(equiv.resultSha256,'24f39e83d0b90f0f739566415fac293e702afaca716c4053367e4677bdb853ce');
for(const variant of ['control','candidate']){assert.equal(equiv.sources[variant].commit,declaration[variant]);assert.equal(equiv.sources[variant].sha256,summary.protocol.engine[variant].sources['src/math/Matrix4.js'])}
const diagnostic=await read('matrix-counts-control.json'),gate=await read('fresh-source-gate.json');
for(const r of [diagnostic,gate]){assert.equal(r.result.frames,30);assert.equal(r.result.warmup,120);assert.equal(r.result.models,45);assert.equal(r.result.fullModels,20);assert.equal(r.result.retained,45);assert.equal(r.result.hidden,0);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[]);assert.equal(r.result.glError,0);assert.equal(r.picks.visiblePick,true);assert.deepEqual(r.applicationSnapshot,pairs[0][0].applicationSnapshot);assert.deepEqual(r.result.pixels,pairs[0][0].result.pixels)}
assert.deepEqual(diagnostic.result.matrixCounts,{calls:13830,default:13830,float32:0,other:0,offsetZero:13830,nativeEligible:0});
const screening=await read('screening.json');assert.equal(screening.excludedFromQualification,true);assert.equal(screening.rejectedShaderKeyPrototype.records['fresh-key-counts-candidate.json'].counts.keyCounts.hits,0);
for(const name of await readdir(ev)){if(!name.endsWith('.json')&&!name.endsWith('.log'))continue;assert.ok(!/\/Users\/|\/private\/tmp\/|fixture-signature|eyJhbGci/.test(await readFile(join(ev,name),'utf8')),'Private data in '+name)}
console.log(JSON.stringify({verified:true,measuredFrames:frames,matchedPairedCaptures:captures,scriptCpuImprovementPercent:summary.threadCpu.stats.scriptMs.improvementPercent,scriptCpuImprovement95CI:summary.threadCpu.stats.scriptMs.improvement95CI,frameIntervalImprovement95CI:summary.stats.frameIntervalMs.improvement95CI,rendererBudget:summary.budget.status,currentFrozenApplicationQualified:true},null,2));
