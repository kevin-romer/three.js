import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const [out]=process.argv.slice(2),x=JSON.parse(await readFile(join(out,'stable-scene.json'),'utf8'));
assert.equal(x.runs.length,15);for(const r of x.runs){assert.equal(r.result.frames.length,300);assert.equal(r.result.warmup,120);assert.equal(r.result.draws,1000);assert.equal(r.result.programs,1);assert.deepEqual(r.errors,[])}
let state=20261108;const random=()=>{state=(Math.imul(1664525,state)+1013904223)>>>0;return state/4294967296},percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1],mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const results={};for(const variant of ['fork','fork-default']){
 const pairs=Array.from({length:5},(_,i)=>{const a=x.runs.find(r=>r.round===i+1&&r.variant==='r187'),b=x.runs.find(r=>r.round===i+1&&r.variant===variant);assert.equal(a.result.pixels,b.result.pixels);assert.equal(a.result.device,b.result.device);assert.equal(a.browser,b.browser);const baseline=a.result.metrics.p95,candidate=b.result.metrics.p95,budget=Math.max(.3,.05*baseline);return{round:i+1,baseline,candidate,budget,regressionMs:candidate-baseline,budgetExcessMs:candidate-baseline-budget,ratio:candidate/baseline}});
 const excess=[],delta=[];for(let n=0;n<10000;n++){const selected=Array.from({length:5},()=>pairs[Math.floor(random()*5)]);excess.push(mean(selected.map(p=>p.budgetExcessMs)));delta.push(mean(selected.map(p=>p.regressionMs)))}
 const ci=[percentile(excess,.025),percentile(excess,.975)],status=ci[1]<=0?'passes-regression-budget':ci[0]>0?'reproducible-regression':'unqualified-noise';results[variant]={status,pairs,meanRegressionMs:mean(pairs.map(p=>p.regressionMs)),regression95CI:[percentile(delta,.025),percentile(delta,.975)],budgetExcess95CI:ci};
}
const result={schemaVersion:1,scope:'Engine stable scene, 1000 meshes sharing one geometry and material; not a full Studio benchmark.',method:'Five rounds, alternating triad order; 120 warmup and 300 measured frames per run. Bootstrap 10000 paired run means, seed 20261108. Budget is max(5% baseline p95, 0.3ms).',results};await writeFile(join(out,'stable-scene-summary.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
