import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repoArg,outArg,control,candidate]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg),refs={control,candidate};
await mkdir(out,{recursive:true});
const implementations={},sources={};
for(const variant of ['control','candidate']){
 const source=execFileSync('git',['show',refs[variant]+':src/renderers/webgl/WebGLBindingStates.js'],{cwd:repo,encoding:'utf8'});
 sources[variant]={commit:refs[variant],sha256:createHash('sha256').update(source).digest('hex')};
 const module=source.replace(/from '([^']+)'/g,(_,name)=>`from '${pathToFileURL(resolve(repo,'src/renderers/webgl',name))}'`),file=join(out,variant+'-binding-module.mjs');
 await writeFile(file,module);implementations[variant]=(await import(pathToFileURL(file))).WebGLBindingStates;
}
function fixture(create,count){
 let created=0,deleted=0,bound;const live=new Set();
 const gl={getParameter:()=>16,createVertexArray(){const vao={id:++created};live.add(vao);return vao},bindVertexArray:vao=>bound=vao,deleteVertexArray(vao){assert.ok(live.delete(vao),'no double deletion');deleted++}};
 const states=create(gl,{}),object={},material={wireframe:false},q={id:2,getAttributes:()=>({})},p={id:1,getAttributes:()=>({})},target={id:count+1,attributes:{}};
 const retained=[];for(let i=1;i<=count;i++){states.setup(object,material,q,{id:i,attributes:{}},null);if(i===1||i===count||i===Math.floor(count/2))retained.push(bound)}
 states.setup(object,material,p,target,null);
 const cycle=()=>{states.releaseStatesOfProgram(p);states.setup(object,material,p,target,null)};
 let reads=0;const observed={get id(){reads++;return 1}};
 const before=deleted;states.releaseStatesOfProgram(observed);const populatedReads=reads;assert.equal(deleted-before,1);assert.ok(retained.every(v=>live.has(v)));
 reads=0;states.releaseStatesOfProgram(observed);const emptyReads=reads;assert.equal(deleted-before,1);
 states.setup(object,material,p,target,null);
 return {cycle,reads:{populated:populatedReads,empty:emptyReads},finish(){assert.equal(live.size,count+1);states.dispose();assert.equal(live.size,0);assert.equal(created,deleted);return {created,deleted,live:0,unrelatedBindingsPreserved:true}}};
}
const cases=[];
for(const count of [256,4096,16384]){
 const pairRecords=[];
 for(let pair=1;pair<=5;pair++){
  const records={};for(const variant of pair%2?['control','candidate']:['candidate','control']){
   const f=fixture(implementations[variant],count);for(let i=0;i<32;i++)f.cycle();
   const start=performance.now();for(let i=0;i<256;i++)f.cycle();const elapsedMs=performance.now()-start;
   records[variant]={elapsedMs,cycles:256,programIdReads:f.reads,lifecycle:f.finish()};
  }
  pairRecords.push({pair,...records});
 }
 const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
 cases.push({unrelatedGeometryCount:count,pairs:pairRecords,medianCycleMs:Object.fromEntries(['control','candidate'].map(v=>[v,median(pairRecords.map(p=>p[v].elapsedMs/256))]))});
}
const result={node:process.version,scope:'Actual WebGLBindingStates module at a mock GL boundary. CPU release-and-recreate cycles include reverse-index maintenance. No GPU timing, browser speedup or memory-byte claim. Diagnostic id getters run outside timed loops. Five AB/BA pairs, 32 warmup and 256 measured cycles per member.',sources,cases};
await writeFile(join(out,'binding-probe.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({cases:cases.map(c=>({count:c.unrelatedGeometryCount,medianCycleMs:c.medianCycleMs,programIdReads:{control:c.pairs[0].control.programIdReads,candidate:c.pairs[0].candidate.programIdReads}}))},null,2));
