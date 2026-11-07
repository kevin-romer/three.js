import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const audit=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repo=process.argv[2]?resolve(process.argv[2]):resolve(audit,'../..');
const json=async name=>JSON.parse(await readFile(join(audit,name),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const manifest=await json('manifest.json');
for(const [file,expected]of Object.entries(manifest.files)){
 const bytes=await readFile(join(audit,file));assert.equal(bytes.length,expected.bytes,file);assert.equal(sha(bytes),expected.sha256,file);
 if(!file.endsWith('.gz'))assert(!bytes.toString().includes('/'+'Users'+'/'),'Private absolute path in '+file);
}
const census=await json('evidence/source-census.json');
assert.equal(census.files.length,1649);assert.deepEqual(census.parseErrors,[]);
for(const file of census.files)assert.equal(sha(await readFile(join(repo,file.file))),file.sha256,file.file);
execFileSync('git',['diff','--exit-code','--name-only','7e89746a687bb88271253698fa108b1dd59825d0','--','src','examples','test','editor','tsl','utils','build','package.json','package-lock.json'],{cwd:repo});
const register=await json('findings.json');assert.equal(register.findings.length,28);
assert.equal(new Set(register.findings.map(f=>f.id)).size,28);
for(const item of register.findings){
 assert([1,2,3].includes(item.priority));assert(item.proposedChange&&item.acceptance&&item.observation);
 for(const source of item.source){const lines=(await readFile(join(repo,source.file),'utf8')).split('\n');assert(source.line>0&&source.line<=lines.length,item.id+': source line')}
 for(const name of item.evidence)await readFile(join(audit,name));
 const [detail,anchor]=item.detailDocument.split('#');const text=await readFile(join(audit,detail),'utf8');
 if(anchor){const slugs=text.split('\n').filter(l=>/^#+ /.test(l)).map(l=>l.replace(/^#+ /,'').toLowerCase().replace(/[^\w\s-]/g,'').replace(/ /g,'-'));assert(slugs.includes(anchor),item.id+': detail anchor '+anchor)}
}
const cpu=await json('evidence/cpu-probes.json');
assert.deepEqual(cpu.fileRequestIsolation.received,['scope-A','scope-A']);assert.equal(cpu.fileRequestIsolation.fetches,1);
assert.equal(cpu.fileResponseTypes.second,'ArrayBuffer');assert.equal(cpu.fileResponseTypes.expectedSecond,'String');
assert.deepEqual(cpu.bitmapOptionsRace.received,['flipY','flipY']);
assert.deepEqual(cpu.webgpuPadding,{vertices:100000,dirtyComponents:1,newCpuBytes:400000,subarrayViews:100000,gpuWrites:1,gpuBytes:4});
assert.deepEqual(cpu.webgpuOverlappingRanges,{dirtyRanges:256,uniqueBytes:16,writeCalls:256,submittedBytes:4096});
assert.equal(cpu.webgpuAlignedFuzz.trials,500);assert.equal(cpu.webgpuAlignedFuzz.status,'passed');
assert.equal(cpu.animation.coldBindingNameReads,9500500);assert.equal(cpu.animation.warmUpdateNameReads,0);assert.deepEqual(cpu.animation.afterUncache,{actions:0,bindings:0});
assert.equal(cpu.gltfCopies.totalCopiedBytes,3145684);assert.equal(cpu.gltfCopies.slices.reduce((n,s)=>n+s.copyBytes,0),3145684);assert.equal(cpu.gltfCopies.vertices,65535);
assert.equal(cpu.stlPreflight.inputBytes,84);assert.equal(cpu.stlPreflight.attemptedFloatAllocationBytes,36000000);assert(cpu.stlPreflight.actualLargeAllocationPrevented);
const browser=await json('evidence/browser-probes.json');
const [control,shared]=browser.ownership;
assert.equal(control.before.sha256,control.after.sha256);assert.equal(control.after.glError,0);assert(control.after.colored>0);
assert(shared.before.colored>0);assert.equal(shared.after.colored,0);assert.equal(shared.after.glError,1282);
assert.deepEqual(browser.subscriptions.map(s=>s.material),[1,2,3]);assert(browser.subscriptions.every(s=>s.geometry===0&&s.texture===0));
assert.deepEqual(browser.afterAssetDispose,{geometry:0,material:0,texture:0});
assert.equal(browser.webgpu.backend,true);assert.equal(browser.webgpu.pixelBytes,4096);assert.equal(browser.webgpu.colored,256);assert(browser.webgpu.memory.total>0);
assert.deepEqual(browser.audioState,{isPlaying:false,connected:false,hasEndedCallback:false});assert.deepEqual(browser.controlListeners,{before:6,after:0});assert.deepEqual(browser.pageErrors,[]);
const suites=await json('evidence/suite-summary.json');assert.equal(suites.length,8);
for(const suite of suites){
 const raw=await json('evidence/'+suite.artifact);assert.deepEqual(raw.result.counts,{passed:suite.passed,failed:suite.failed,skipped:suite.skipped,todo:suite.todo,total:suite.total});
 assert.deepEqual(suite.pageErrors,[]);assert.deepEqual(suite.external,[]);
 assert.equal(raw.tests.length,suite.total);assert.equal(raw.tests.filter(t=>t.status==='failed').length,suite.failed);
 if(suite.suite==='addons'){assert.equal(suite.passed,145);assert.equal(suite.failed,0);assert.equal(suite.todo,0);assert.deepEqual(suite.missing,['test/unit/texture.test'])}
 else{
  assert.equal(suite.total,1983);assert.equal(suite.todo,1);assert.deepEqual(suite.missing,[]);
  const fallback=suite.engine!=='chrome';assert.equal(suite.failed,fallback?11:0);assert.equal(suite.passed,fallback?1971:1982);
  if(suite.version==='r187'){
   assert.deepEqual(suite.backends,[{requested:'webgpu',actual:fallback?'webgl':'webgpu'},{requested:'webgl',actual:'webgl'}]);
   assert.equal(suite.testsWithSoftSkip,fallback?11:0);
  }
 }
}
const lint=await json('evidence/lint-summary.json');assert.equal(lint.length,8);
for(const scope of lint){const raw=await json('evidence/lint-'+scope.scope+'.json');assert.equal(raw.results.length,scope.files);assert.equal(raw.results.reduce((n,r)=>n+r.errors,0),scope.errors);assert.equal(raw.results.reduce((n,r)=>n+r.warnings,0),scope.warnings)}
assert.equal(lint.reduce((n,r)=>n+r.errors,0),26);assert.equal(lint.reduce((n,r)=>n+r.warnings,0),2);assert.equal(lint.filter(r=>r.errors===0&&r.warnings===0).length,6);
const build=await json('evidence/build-results.json');assert.equal(build.files.length,5);assert(build.files.every(f=>f.matchesPublished));assert.deepEqual(build.warnings,[]);
for(const f of build.files)assert.equal(sha(await readFile(join(repo,'build',f.name))),f.sha256,f.name);
const bundles=await json('evidence/bundle-results.json');assert.equal(bundles.files.length,11);assert(bundles.files.every(f=>f.bytes>f.gzipBytes));assert.deepEqual(bundles.warnings,[]);
const bench=await json('evidence/material-benchmark.json');assert.equal(bench.samples.length,9);
for(const sample of bench.samples){assert.equal(sample.count,10000);if(sample.mode==='shader-material'){assert.equal(sample.backend,'WebGLRenderer');assert.equal(sample.firstPrograms,1);assert.equal(sample.updatePrograms,0);assert.equal(sample.drawCalls,10000)}else{assert.equal(sample.backend,'WebGPU');assert.equal(sample.firstBuilds,sample.mode==='material-instance'?1:10000);assert.equal(sample.updateBuilds,0);assert.equal(sample.drawCalls,10001)}}
const coverage=await json('evidence/function-execution.json');assert.equal(coverage.loadedFiles,809);assert.equal(coverage.functionsObserved,7326);assert.equal(coverage.functionsExecuted,4317);assert.equal(coverage.files.reduce((n,f)=>n+f.functionsExecuted,0),4317);
const deps=await json('evidence/dependency-audit.json');assert.deepEqual(deps.metadata.vulnerabilities,{info:0,low:2,moderate:6,high:0,critical:0,total:8});
const advisories=new Set(Object.values(deps.vulnerabilities).flatMap(v=>v.via.filter(x=>typeof x==='object').map(x=>x.url)));assert.equal(advisories.size,2);
const crosscheck=await json('evidence/dev-crosscheck.json');assert.equal(crosscheck.files.length,11);assert.equal(crosscheck.files.filter(f=>!f.identical).length,1);
assert.equal(crosscheck.files.find(f=>!f.identical).file,'src/renderers/WebGLRenderer.js');
for(const f of await readdir(audit)){if(!f.endsWith('.md'))continue;const text=await readFile(join(audit,f),'utf8');for(const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)){const target=match[1].split('#')[0];if(!target||/^[a-z]+:/.test(target))continue;await readFile(join(audit,target)).catch(async error=>{if(error.code==='EISDIR')return;throw error})}}
console.log(JSON.stringify({verifiedArtifacts:Object.keys(manifest.files).length,sourceHashes:1649,findings:28,qunitConfigurations:8,releaseOutputs:5,bundleConfigurations:11,materialBenchmarkRuns:9,alignmentFuzzCases:500,baselineFailuresPreserved:['shared attribute disposal','FileLoader identity','ImageBitmap options','STL preflight','11 compute tests per fallback browser','example/manual lint','dev advisories']},null,2));
