import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const [app,three,out,stage,control,candidate,scene='buildings',mode='timing',roundCount='5']=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
if(!/^[a-z0-9-]+$/.test(stage)||scene!=='buildings'||!['timing','diagnostic'].includes(mode))throw Error('Invalid case');
const rounds=Number(roundCount);assert.ok(Number.isSafeInteger(rounds)&&rounds>=5&&rounds<=20);
const common=process.env.BENCH_COMMON_TOOLS??resolve(root,'../../next-audit/tools');
const sha=b=>createHash('sha256').update(b).digest('hex');
const require=createRequire(join(app,'package.json'));
const refs={control,candidate},tools=['paired.mjs','janus-server.mjs','managed-browser.mjs','studio-synthetic.mjs','product-fixtures.mjs','measure-map.mjs','buildings-run.mjs','cpu-buildings-run.mjs','measure-cpu.mjs'];
async function fingerprint(){
 const toolHashes={};for(const name of tools)toolHashes[name]=sha(await readFile(join(['paired.mjs','cpu-buildings-run.mjs','measure-cpu.mjs'].includes(name)?root:common,name)));
 const changed=execFileSync('git',['diff','--name-only',control,candidate,'--','src'],{cwd:three,encoding:'utf8'}).trim().split('\n').filter(Boolean),engine={};
 for(const variant of ['control','candidate']){engine[variant]={ref:execFileSync('git',['rev-parse',refs[variant]+'^{commit}'],{cwd:three,encoding:'utf8'}).trim(),sources:{}};for(const file of new Set([...changed,'src/renderers/WebGLRenderer.js','src/renderers/webgl/WebGLPrograms.js']))engine[variant].sources[file]=sha(execFileSync('git',['show',refs[variant]+':'+file],{cwd:three}));}
 const packages={};for(const name of ['package.json','package-lock.json'])packages[name]=sha(await readFile(join(app,name)));
 let applicationSnapshot=null;if(process.env.BENCH_APP_MANIFEST){const manifest=JSON.parse(await readFile(process.env.BENCH_APP_MANIFEST));for(const [file,expected]of Object.entries(manifest.sourceFiles))assert.equal(sha(await readFile(join(app,file))),expected);applicationSnapshot={sha256:sha(JSON.stringify(manifest.sourceFiles)),files:Object.keys(manifest.sourceFiles).length};}
 const runtimeDependencies={};for(const name of ['vite','playwright','typescript','react','react-dom','@vitejs/plugin-react','@tailwindcss/vite']){let bytes;try{bytes=await readFile(require.resolve(name+'/package.json'))}catch(error){if(error.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw error;let dir=dirname(require.resolve(name));while(true){try{const candidateBytes=await readFile(join(dir,'package.json'));if(JSON.parse(candidateBytes).name===name){bytes=candidateBytes;break}}catch{}if(dirname(dir)===dir)throw Error('Package manifest not found: '+name);dir=dirname(dir)}}runtimeDependencies[name]={version:JSON.parse(bytes).version,packageJsonSha256:sha(bytes)};}
 return {version:6,cpuTimeDomain:'threadTicks',primaryMetric:'threadCpu.scriptMs/frames',pairedRounds:mode==='timing'?rounds:1,applicationSnapshot,runtimeDependencies,node:process.versions.node,tools:toolHashes,engine,packages,cacheBudgetBothVariants:16,scene,mode};
}
const frozen=await fingerprint(),runs=[];let servedSnapshot=null;
for(let pair=1;pair<=(mode==='timing'?rounds:1);pair++)for(const variant of pair%2?['control','candidate']:['candidate','control']){
 assert.deepEqual(await fingerprint(),frozen,'Inputs changed');
 const label=`${stage}-${scene}-${mode}-pair${pair}-${variant}`,config={label,frames:mode==='timing'?300:30,warmup:120,correctness:true,diagnostics:mode==='diagnostic'};
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(scene==='studio'?common:root,scene==='studio'?'studio-synthetic.mjs':'cpu-buildings-run.mjs'),app,three,out,variant],{env:{...process.env,BENCH_ENGINE_REF:refs[variant],BENCH_RUN:JSON.stringify(config)},stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const s=b.toString();log+=s;if(!s.startsWith('RESULT'))process.stdout.write(s)});child.on('error',reject);child.on('exit',async code=>{await writeFile(join(out,label+'.log'),log);code===0?resolve():reject(Error(label+' failed '+code))})});
 assert.deepEqual(await fingerprint(),frozen,'Inputs changed');
 const record=JSON.parse(await readFile(join(out,label+'.json')));const currentSnapshot=sha(JSON.stringify(record.appSources));if(servedSnapshot===null)servedSnapshot=currentSnapshot;else assert.equal(currentSnapshot,servedSnapshot,'Served application files changed within campaign');record.protocol=frozen;await writeFile(join(out,label+'.json'),JSON.stringify(record,null,2));runs.push({pair,variant,label});
 console.log('MEMBER',JSON.stringify({label,p95:record.result.metrics.engineMs.p95,frames:record.result.frames,errors:record.errors}));
 await writeFile(join(out,`${stage}-${scene}-${mode}-progress.json`),JSON.stringify({runs},null,2));
 if(runs.filter(x=>x.pair===pair).length===2){const a=JSON.parse(await readFile(join(out,`${stage}-${scene}-${mode}-pair${pair}-control.json`))),b=JSON.parse(await readFile(join(out,`${stage}-${scene}-${mode}-pair${pair}-candidate.json`)));assert.deepEqual(a.appSources,b.appSources);assert.deepEqual(a.result.pixels,b.result.pixels);assert.deepEqual(a.data,b.data);assert.deepEqual(a.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]),b.result.summaries.map(s=>[s.draws,s.triangles,s.renderCalls]));for(const r of [a,b]){assert.equal(r.result.glError,0);assert.deepEqual(r.errors,[]);assert.deepEqual(r.logs,[])}console.log('PAIR_PASSED',stage,scene,mode,pair);}
}
