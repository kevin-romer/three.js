import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const audit=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=async name=>JSON.parse(await readFile(join(audit,name),'utf8'));
const manifest=await read('manifest.json');
for(const [file,expected] of Object.entries(manifest.files)){
 const bytes=await readFile(join(audit,file));
 assert.equal(bytes.length,expected.bytes,file);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),expected.sha256,file);
}
const cpu=await read('evidence/cpu-results.json'),gpu=await read('evidence/gpu-results.json');
assert.equal(cpu.freeIdRefill.length,18);
assert.equal(cpu.randomizedOperationsPerClass,2000);
for(const entry of cpu.freeIdRefill){
 for(const name of ['deleteMs','refillMs','cycleMs'])assert(Number.isFinite(entry[name])&&entry[name]>=0);
 assert(Math.abs(entry.cycleMs-entry.deleteMs-entry.refillMs)<1e-6);
}
assert.deepEqual(cpu.dirtyUbo,{uniforms:256,calls:256,bytes:4096,storageBytes:4096});
assert.deepEqual(cpu.raycasts.map(row=>[row.instances,row.meshTests,row.hits]),[[1024,1024,1],[16384,16384,1]]);
assert.equal(cpu.matrix.default.compositions,10001);assert.equal(cpu.matrix.default.worldMultiplies,10000);
assert.equal(cpu.matrix.manualLocalMatrices.compositions,0);
assert.equal(gpu.results.length,9);
const kind=name=>gpu.results.filter(row=>row.kind===name);
const sum=(trace,key)=>trace[key].reduce((total,entry)=>total+entry.bytes,0);
for(const name of ['hidden','sparse','indirect','resize']){
 const [a,b]=kind(name);assert.equal(a.variant,'upstream');assert.equal(a.glError,0);assert.equal(b.glError,0);
 assert.equal(a.tests.pixels.sha256,b.tests.pixels.sha256);assert(a.tests.pixels.colored>0);
 for(const row of [a,b])assert.match(row.gpu,/Apple M1 Pro/);
 if(name==='hidden')for(let i=0;i<8;i++){assert.equal(sum(a.frames[i],'buffers'),1179648);assert.equal(sum(b.frames[i],'buffers'),0)}
 if(name==='sparse')for(let i=0;i<8;i++){assert.equal(sum(a.frames[i],'textures'),1376256);assert.equal(sum(b.frames[i],'textures'),65616)}
 if(name==='indirect'){
  for(let i=0;i<8;i++){assert.equal(sum(a.frames[i],'textures'),16384);assert.equal(sum(b.frames[i],'textures'),0)}
  assert.deepEqual(a.tests.reorderedIds,b.tests.reorderedIds);
  assert.equal(b.tests.visibleCount,15);assert(sum(b.tests.reordered,'textures')>0);
 }
 if(name==='sparse'||name==='resize'){
  assert.equal(a.tests.cloneGrowPixels.colored,0);
  assert.equal(b.tests.pixels.sha256,b.tests.cloneGrowPixels.sha256);
 }
}
assert.equal(kind('rows')[0].tests.glError,1282);
const regressions=await read('evidence/regression-results.json');
assert.equal(regressions.tests.length,10);assert(regressions.tests.every(row=>row.status==='passed'));
const crosscheck=await read('evidence/development-crosscheck.json');
assert(Object.values(crosscheck.sourcePatternChecks).every(Boolean));
const sources=await read('evidence/source-manifest.json');
const repo=resolve(audit,'../..');
for(const [name,sha] of Object.entries(sources.reviewedFiles)){
 assert.equal(createHash('sha256').update(await readFile(join(repo,name))).digest('hex'),sha,name);
}
console.log(JSON.stringify({verifiedFiles:Object.keys(manifest.files).length,reviewedSources:Object.keys(sources.reviewedFiles).length,webglConfigurations:9,existingRegressionExecutions:10,randomizedOperations:4000,expectedUpstreamFailuresRetained:['blank batch resize','cross-row GL error']},null,2));
