import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const out=resolve(process.argv[2]),root=dirname(fileURLToPath(import.meta.url));
const analyzer=process.env.POOL_BASE_ANALYZER??resolve(root,'../../next-audit/tools/analyze-next.mjs');
execFileSync(process.execPath,[analyzer,out,'pool','buildings'],{stdio:'pipe'});
const path=join(out,'pool-buildings-summary.json'),summary=JSON.parse(await readFile(path));
let seed=20261110;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296};
const percentile=(a,p)=>[...a].sort((a,b)=>a-b)[Math.ceil(a.length*p)-1];
const a=summary.rounds.map(x=>x.control.engineMs.p50),b=summary.rounds.map(x=>x.candidate.engineMs.p50),logs=a.map((x,i)=>Math.log(b[i]/x)),samples=[];
for(let i=0;i<10000;i++){let sum=0;for(let j=0;j<logs.length;j++)sum+=logs[Math.floor(random()*logs.length)];samples.push(Math.exp(sum/logs.length))}
const ci=[percentile(samples,.025),percentile(samples,.975)];
summary.secondaryMedianCpu={metric:'engineMs.p50',method:'10000 paired log-ratio resamples,seed20261110; prespecified secondary metric',controlMs:a,candidateMs:b,improvementPercent:100*(1-Math.exp(logs.reduce((x,y)=>x+y,0)/logs.length)),improvement95CI:ci.toReversed().map(x=>100*(1-x)),ratio95CI:ci};
await writeFile(path,JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({p95:summary.stats.engineMs,p50:summary.secondaryMedianCpu,frameIntervals:summary.stats.frameIntervalMs,budget:summary.budget},null,2));
