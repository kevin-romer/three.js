import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const out=resolve(process.argv[2]),root=dirname(fileURLToPath(import.meta.url));
execFileSync(process.execPath,[join(root,'analyze-pairs.mjs'),out,'matrix','buildings','20'],{stdio:'pipe'});
const path=join(out,'matrix-buildings-summary.json'),summary=JSON.parse(await readFile(path)),pairs=[];
for(let i=1;i<=20;i++){
 const pair=[];for(const v of ['control','candidate']){const r=JSON.parse(await readFile(join(out,`matrix-buildings-timing-pair${i}-${v}.json`)));assert.equal(r.result.threadCpu.timeDomain,'threadTicks');assert.equal(r.result.frames,300);pair.push(r.result.threadCpu)}pairs.push(pair);
}
const rng=seed=>()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296},pct=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const cpu={};
for(const [metric,seed]of [['scriptMs',20261112],['taskMs',20261113]]){
 const a=pairs.map(p=>p[0][metric]/300),b=pairs.map(p=>p[1][metric]/300),logs=a.map((x,i)=>Math.log(b[i]/x)),samples=[],random=rng(seed);
 for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<20;j++)sum+=logs[Math.floor(random()*20)];samples.push(Math.exp(sum/20))}
 const ci=[pct(samples,.025),pct(samples,.975)];cpu[metric]={controlMsPerFrame:a,candidateMsPerFrame:b,improvementPercent:100*(1-Math.exp(logs.reduce((a,b)=>a+b,0)/20)),improvement95CI:ci.toReversed().map(x=>100*(1-x)),ratio95CI:ci,seed};
}
summary.primaryMetric='Mean main-thread script CPU per frame; CDP Performance threadTicks, boundary samples around 300 measured frames';summary.threadCpu={method:'20 alternating paired rounds; 10000 paired log-ratio resamples, seeds 20261112 and 20261113. Warmup and readbacks excluded; frames are not independent trials.',stats:cpu};
summary.shippingCriterion={primaryImprovement:cpu.scriptMs.improvement95CI[0]>0,rendererBudget:summary.budget.status,qualified:cpu.scriptMs.improvement95CI[0]>0&&summary.budget.status==='pass'};
await writeFile(path,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({threadCpu:cpu,renderer:summary.stats.engineMs,frameInterval:summary.stats.frameIntervalMs,budget:summary.budget,shipping:summary.shippingCriterion},null,2));
