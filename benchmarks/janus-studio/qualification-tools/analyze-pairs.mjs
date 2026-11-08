import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [out,name='desktop']=process.argv.slice(2),pairs=[];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const application=x=>x.applicationSnapshot??{sha256:digest(x.appSources),files:Object.keys(x.appSources).length};
for(let i=1;i<=5;i++){
 const a=JSON.parse(await readFile(join(out,`${name}-pair${i}-r187.json`))),b=JSON.parse(await readFile(join(out,`${name}-pair${i}-fork.json`)));
 assert.deepEqual(application(a),application(b),'Application sources differ within pair '+i);
 for(const x of [a,b]){assert.equal(x.result.frames,300);assert.ok(x.result.warmup>=120);assert.equal(x.result.glError,0);assert.equal(x.errors.length,0);assert.equal(x.logs.length,0);assert.ok(x.result.summaries.every(s=>s.draws>0&&s.triangles>0));assert.equal(x.result.pixels.length,3);assert.ok(x.result.pixels.every(p=>p.colored>0&&p.nonzeroAlpha>0))}
 assert.deepEqual(a.protocol,b.protocol,'Runner, engine or helper inputs differ within pair '+i);assert.deepEqual(a.data,b.data);assert.deepEqual(a.result.pixels,b.result.pixels);assert.equal(a.browser,b.browser);assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));
 pairs.push({pair:i,order:i%2?['r187','fork']:['fork','r187'],baseline:a,candidate:b});
}
let state=20261107;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296};
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const stats={};for(const metric of ['engineMs','renderMs','resetMs','actionMs','frameIntervalMs']){
 const ratios=pairs.map(p=>p.candidate.result.metrics[metric].p95/p.baseline.result.metrics[metric].p95),log=ratios.map(Math.log),geomean=Math.exp(log.reduce((a,b)=>a+b,0)/log.length),bootstrap=[];
 for(let n=0;n<10000;n++){let sum=0;for(let k=0;k<5;k++)sum+=log[Math.floor(random()*5)];bootstrap.push(Math.exp(sum/5))}
 const ci=[percentile(bootstrap,.025),percentile(bootstrap,.975)];stats[metric]={pairedP95Ratios:ratios,geometricMeanRatio:geomean,improvementPercent:100*(1-geomean),ratio95CI:ci,improvement95CI:ci.toReversed().map(x=>100*(1-x)),baselineP95Ms:pairs.map(p=>p.baseline.result.metrics[metric].p95),candidateP95Ms:pairs.map(p=>p.candidate.result.metrics[metric].p95)};
}
const result={schemaVersion:1,case:name,method:'Five paired AB/BA rounds; bootstrap 10000 resamples of paired log p95 CPU ratios, seed 20261107. Frames are not treated as independent runs.',stats,primaryTargetMet:stats.engineMs.improvementPercent>=15&&stats.engineMs.ratio95CI[1]<1,checks:{appHashMatchesWithinPairs:true,pixelsMatch:true,nonempty:true,equalDrawAndTriangleCounts:true,errors:0},pairs:pairs.map(p=>({pair:p.pair,order:p.order,application:application(p.baseline),data:p.baseline.data,browser:p.baseline.browser,device:p.baseline.result.device,baseline:p.baseline.result.metrics,candidate:p.candidate.result.metrics,pixels:p.baseline.result.pixels,programs:{baseline:p.baseline.result.programs,candidate:p.candidate.result.programs},heapUsedApprox:{baseline:p.baseline.result.heapUsedApprox,candidate:p.candidate.result.heapUsedApprox},startup:{baseline:p.baseline.startup,candidate:p.candidate.startup},longTasks:{baseline:p.baseline.result.longTasks,candidate:p.candidate.result.longTasks}}))};
await writeFile(join(out,name+'-paired-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({case:name,primaryTargetMet:result.primaryTargetMet,stats:result.stats.engineMs,checks:result.checks},null,2));
