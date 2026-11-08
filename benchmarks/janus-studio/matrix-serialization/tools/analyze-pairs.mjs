import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const [out,stage,scene='studio',roundCount='5']=process.argv.slice(2),pairs=[],rounds=Number(roundCount);
assert.ok(Number.isSafeInteger(rounds)&&rounds>=5&&rounds<=20);
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),snapshot=x=>x.applicationSnapshot??{sha256:hash(x.appSources),files:Object.keys(x.appSources).length};
for(let round=1;round<=rounds;round++){
 const a=JSON.parse(await readFile(join(out,`${stage}-${scene}-timing-pair${round}-control.json`))),b=JSON.parse(await readFile(join(out,`${stage}-${scene}-timing-pair${round}-candidate.json`)));
 assert.deepEqual(snapshot(a),snapshot(b));for(const k of ['protocol','data','browser'])assert.deepEqual(a[k],b[k]);assert.equal(a.result.device,b.result.device);assert.deepEqual(a.result.pixels,b.result.pixels);
 for(const r of [a,b]){assert.equal(r.result.frames,300);assert.equal(r.result.warmup,120);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[]);assert.equal(r.result.glError,0);assert.equal(r.result.pixels.length,3);assert.ok(r.result.summaries.every(x=>x.draws>0&&x.triangles>0))}
 assert.deepEqual(a.result.summaries.map(x=>[x.draws,x.triangles,x.renderCalls]),b.result.summaries.map(x=>[x.draws,x.triangles,x.renderCalls]));
 pairs.push({round,control:a,candidate:b});
}
const rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296},pct=(x,p)=>[...x].sort((a,b)=>a-b)[Math.ceil(x.length*p)-1],random=rng(20261108),stats={};
for(const metric of ['engineMs','frameIntervalMs']){
 const a=pairs.map(p=>p.control.result.metrics[metric].p95),b=pairs.map(p=>p.candidate.result.metrics[metric].p95),logs=a.map((v,i)=>Math.log(b[i]/v)),samples=[];
 for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<rounds;j++)sum+=logs[Math.floor(random()*rounds)];samples.push(Math.exp(sum/rounds))}
 const ratio=Math.exp(logs.reduce((a,b)=>a+b,0)/rounds),ci=[pct(samples,.025),pct(samples,.975)];stats[metric]={controlP95Ms:a,candidateP95Ms:b,improvementPercent:100*(1-ratio),improvement95CI:ci.toReversed().map(r=>100*(1-r)),ratio95CI:ci};
}
const budgetRandom=rng(20261109),excess=pairs.map(p=>{const a=p.control.result.metrics.engineMs.p95,b=p.candidate.result.metrics.engineMs.p95;return b-a-Math.max(.3,.05*a)}),samples=[];
for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<rounds;j++)sum+=excess[Math.floor(budgetRandom()*rounds)];samples.push(sum/rounds)}
const ci=[pct(samples,.025),pct(samples,.975)],budget={rule:'max(5% control p95,0.3ms); paired mean excess bootstrap,10000 resamples,seed20261109',excessByRoundMs:excess,excess95CI:ci,status:ci[1]<=0?'pass':ci[0]>0?'regression':'unqualified'};
const result={stage,scene,pairedRounds:rounds,method:'Alternating paired rounds;120 warmup+300 measured frames/run.10000 paired log-ratio resamples,seed20261108;frames are not independent runs.',protocol:pairs[0].control.protocol,stats,budget,checks:{pairedPixelsAndWorkMatch:true,nonemptyFrames:600*rounds,errors:0},rounds:pairs.map(p=>({round:p.round,applicationSnapshot:snapshot(p.control),control:p.control.result.metrics,candidate:p.candidate.result.metrics,startup:{control:p.control.startup,candidate:p.candidate.startup},longTasks:{control:p.control.result.longTasks,candidate:p.candidate.result.longTasks}}))};
await writeFile(join(out,`${stage}-${scene}-summary.json`),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({stage,scene,stats,budget},null,2));
