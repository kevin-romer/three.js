import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const [out]=process.argv.slice(2),cases=[];
let seed=20261108;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296},mean=a=>a.reduce((a,b)=>a+b,0)/a.length,percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
for(const name of ['desktop','buildings','scale100','mobile']){
 const pairs=[];
 for(let round=1;round<=5;round++){
  const a=JSON.parse(await readFile(join(out,`${name}-pair${round}-r187.json`))),b=JSON.parse(await readFile(join(out,`${name}-pair${round}-fork.json`)));
  const baseline=a.result.metrics.engineMs.p95,candidate=b.result.metrics.engineMs.p95,budget=Math.max(.3,.05*baseline);pairs.push({round,baseline,candidate,budget,deltaMs:candidate-baseline,budgetExcessMs:candidate-baseline-budget});
 }
 const samples=[];for(let n=0;n<10000;n++)samples.push(mean(Array.from({length:5},()=>pairs[Math.floor(random()*5)].budgetExcessMs)));
 const ci=[percentile(samples,.025),percentile(samples,.975)],status=ci[1]<=0?'passes-regression-budget':ci[0]>0?'reproducible-regression':'unqualified';cases.push({name,status,pairs,budgetExcess95CI:ci});
}
const stable=JSON.parse(await readFile(join(out,'stable-scene-summary.json')));for(const [variant,result]of Object.entries(stable.results))cases.push({name:'stable1000-'+variant,status:result.status,budgetExcess95CI:result.budgetExcess95CI});
const result={scope:'p95 main-thread Three.js render/reset CPU; other metrics reported separately.',method:'Budget is max(5% of paired baseline p95, 0.3ms). 10000 paired-round bootstrap mean budget-excess samples, seed 20261108. Upper95 bound <=0 passes; lower95 >0 is reproducible breach; overlap remains unqualified.',cases,passed:cases.every(c=>c.status==='passes-regression-budget')};await writeFile(join(out,'regression-budget.json'),JSON.stringify(result,null,2));assert.equal(result.passed,true);console.log(JSON.stringify({passed:result.passed,cases:cases.map(c=>({name:c.name,status:c.status,ci:c.budgetExcess95CI}))},null,2));
