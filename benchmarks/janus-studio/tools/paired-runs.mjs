import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out,caseName='desktop']=process.argv.slice(2);
const root=dirname(fileURLToPath(import.meta.url));
if(!['desktop','mobile','buildings','scale100'].includes(caseName))throw Error('Unknown benchmark case');
const config=caseName==='mobile'?{viewport:{width:390,height:844},cpuRate:4}:caseName==='buildings'?{fixture:'buildings'}:caseName==='scale100'?{count:100}:{};
const runs=[];
for(let pair=0;pair<5;pair++)for(const variant of pair%2?['fork','r187']:['r187','fork']){
 const label=caseName+'-pair'+(pair+1)+'-'+variant;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,caseName==='buildings'?'buildings-run.mjs':'studio-synthetic.mjs'),app,three,out,variant],{env:{...process.env,BENCH_RUN:JSON.stringify({...config,label,frames:300,warmup:120})},stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const s=b.toString();log+=s;if(!s.startsWith('RESULT'))process.stdout.write(s)});child.on('error',reject);child.on('exit',async code=>{await writeFile(join(out,label+'.log'),log);if(code!==0)reject(Error(label+' failed with '+code));else resolve()})});
 const r=JSON.parse(await readFile(join(out,label+'.json'),'utf8'));runs.push({pair:pair+1,variant,label});
 console.log('PAIR_MEMBER',JSON.stringify({label,metrics:r.result.metrics.engineMs,frames:r.result.frames,errors:r.errors,pixels:r.result.pixels.map(p=>p.sha256)}));
 await writeFile(join(out,caseName+'-progress.json'),JSON.stringify({runs},null,2));
}
console.log('PAIRED_RUNS_COMPLETE',caseName);
