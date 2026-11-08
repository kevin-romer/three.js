import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out,caseName='desktop']=process.argv.slice(2);
const root=dirname(fileURLToPath(import.meta.url));
if(!['desktop','mobile','buildings','scale100'].includes(caseName))throw Error('Unknown benchmark case');
const config=caseName==='mobile'?{viewport:{width:390,height:844},cpuRate:4}:caseName==='buildings'?{fixture:'buildings'}:caseName==='scale100'?{count:100}:{};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fingerprint(){
 const tools={};for(const name of ['paired-runs.mjs','managed-browser.mjs','janus-server.mjs','measure-map.mjs','product-fixtures.mjs','studio-synthetic.mjs','buildings-run.mjs'])tools[name]=hash(await readFile(join(root,name)));
 const engine={};for(const name of ['src/renderers/WebGLRenderer.js','src/renderers/webgl/WebGLPrograms.js'])engine[name]=hash(await readFile(join(three,name)));
 const helper=await readFile(join(app,'e2e/janus-scenario-studio-workspace.spec.ts'),'utf8'),boundary=helper.indexOf('test("Scenario workspace keeps');if(boundary<0)throw Error('Application fixture adapter boundary changed');
 const applicationPackages={};for(const name of ['package.json','package-lock.json'])applicationPackages[name]=hash(await readFile(join(app,name)));
 return{version:2,node:process.versions.node,engineSourceCommit:execFileSync('git',['log','-1','--format=%H','--','src'],{cwd:three,encoding:'utf8'}).trim(),upstreamCommit:execFileSync('git',['rev-parse','r187^{commit}'],{cwd:three,encoding:'utf8'}).trim(),engine,tools,applicationPackages,fixtureHelperPrefixSha256:hash(helper.slice(0,boundary))};
}
const immutable=await fingerprint();
const runs=[];
for(let pair=0;pair<5;pair++)for(const variant of pair%2?['fork','r187']:['r187','fork']){
 const before=await fingerprint();assert.deepEqual(before.tools,immutable.tools,'Benchmark code changed during the campaign');assert.deepEqual(before.engine,immutable.engine,'Engine code changed during the campaign');
 const label=caseName+'-pair'+(pair+1)+'-'+variant;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,caseName==='buildings'?'buildings-run.mjs':'studio-synthetic.mjs'),app,three,out,variant],{env:{...process.env,BENCH_RUN:JSON.stringify({...config,label,frames:300,warmup:120})},stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const s=b.toString();log+=s;if(!s.startsWith('RESULT'))process.stdout.write(s)});child.on('error',reject);child.on('exit',async code=>{await writeFile(join(out,label+'.log'),log);if(code!==0)reject(Error(label+' failed with '+code));else resolve()})});
 const after=await fingerprint();assert.deepEqual(after,before,'Benchmark inputs changed during this run');
 const r=JSON.parse(await readFile(join(out,label+'.json'),'utf8'));r.protocol=before;await writeFile(join(out,label+'.json'),JSON.stringify(r,null,2));runs.push({pair:pair+1,variant,label});
 console.log('PAIR_MEMBER',JSON.stringify({label,metrics:r.result.metrics.engineMs,frames:r.result.frames,errors:r.errors,pixels:r.result.pixels.map(p=>p.sha256)}));
 await writeFile(join(out,caseName+'-progress.json'),JSON.stringify({runs},null,2));
 if(runs.filter(x=>x.pair===pair+1).length===2){const a=JSON.parse(await readFile(join(out,caseName+'-pair'+(pair+1)+'-r187.json'))),b=JSON.parse(await readFile(join(out,caseName+'-pair'+(pair+1)+'-fork.json')));assert.deepEqual(a.appSources,b.appSources);assert.deepEqual(a.protocol,b.protocol);assert.deepEqual(a.data,b.data);assert.deepEqual(a.result.pixels,b.result.pixels);assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));console.log('PAIR_CORRECTNESS_PASSED',caseName,pair+1)}
}
console.log('PAIRED_RUNS_COMPLETE',caseName);
