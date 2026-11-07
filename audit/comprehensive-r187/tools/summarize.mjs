import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg),evidence=join(out,'delivery/evidence');
await mkdir(evidence,{recursive:true});
const json=async name=>JSON.parse(await readFile(join(out,name),'utf8'));
const save=async(name,value)=>writeFile(join(evidence,name),JSON.stringify(value,null,2)+'\n');
const sanitize=value=>JSON.parse(JSON.stringify(value).split(repo).join('<repo>'));
for(const name of ['source-census.json','cpu-probes.json','browser-probes.json','build-results.json','bundle-results.json','material-benchmark.json','dependency-audit.json'])await save(name,sanitize(await json(name)));
const lint=[];
for(const scope of ['core','addons','test','tsl','editor','utils','examples','manual']){
 const raw=await json('lint-'+scope+'.json');
 const rows=raw.map(row=>({file:row.filePath.slice(repo.length+1),errors:row.errorCount,warnings:row.warningCount,fatal:row.fatalErrorCount,messages:row.messages.map(m=>({line:m.line,column:m.column,endLine:m.endLine,endColumn:m.endColumn,severity:m.severity,rule:m.ruleId,message:m.message}))}));
 const totals={scope,files:rows.length,errors:rows.reduce((n,r)=>n+r.errors,0),warnings:rows.reduce((n,r)=>n+r.warnings,0),fatal:rows.reduce((n,r)=>n+r.fatal,0)};
 await save('lint-'+scope+'.json',{...totals,results:rows});lint.push(totals);
}
await save('lint-summary.json',lint);
const suites=[];
for(const name of (await readdir(out)).filter(n=>/^qunit-.*\.json$/.test(n)&&!n.endsWith('-incomplete.json'))){
 const data=await json(name);await save(name,sanitize(data));
 suites.push({artifact:name,engine:data.engine,browser:data.browser,version:data.version,suite:data.suite,...data.result.counts,runtimeMs:data.result.runtimeMs,backends:data.backends??[],testsWithSoftSkip:data.tests.filter(t=>t.softSkips?.length).length,backendObservationAvailable:!!data.backends,pageErrors:data.errors,missing:data.missing,external:data.external});
}
await save('suite-summary.json',suites);
let preliminary;
try{preliminary=await json('qunit-webkit-r187-addons-incomplete.json')}catch(error){if(error.code!=='ENOENT')throw error}
if(preliminary)await save('harness-preliminary.json',{classification:'Audit harness error, superseded by passing WebKit addon rerun. Blob/data URLs must continue through browser routing. The malformed external entries were produced by concatenating origin and pathname of blob URLs; they are not observed network egress.',original:preliminary});
const coverage=new Map();
for(const suite of ['core','addons']){
 const name='qunit-chrome-r187-'+suite+'-coverage.json.gz',bytes=await readFile(join(out,name));await writeFile(join(evidence,name),bytes);
 for(const script of JSON.parse(gunzipSync(bytes)).result){
  const prefix='https://three-audit.test/';if(!script.url.startsWith(prefix))continue;
  const file=script.url.slice(prefix.length).split('?')[0];if(!file.startsWith('src/')&&!file.startsWith('examples/jsm/'))continue;
  const functions=coverage.get(file)??new Map();coverage.set(file,functions);
  for(const f of script.functions){const range=f.ranges[0];if(f.functionName===''&&range.startOffset===0)continue;const key=f.functionName+':'+range.startOffset+':'+range.endOffset;functions.set(key,(functions.get(key)??false)||range.count>0)}
 }
}
const groups={},files=[];
for(const [file,functions]of coverage){
 const row={file,functionsObserved:functions.size,functionsExecuted:[...functions.values()].filter(Boolean).length};files.push(row);
 const group=file.startsWith('src/')?'src/'+file.split('/')[1]:'addons/'+file.split('/')[2];
 const g=groups[group]??={loadedFiles:0,functionsObserved:0,functionsExecuted:0};g.loadedFiles++;g.functionsObserved+=row.functionsObserved;g.functionsExecuted+=row.functionsExecuted;
}
await save('function-execution.json',{method:'Union of V8 precise coverage for r187 Chromium core and addon suites. Top-level unnamed module wrappers excluded. Loaded functions only; not line, branch, assertion or correctness coverage. Observation-only backend hook affects helper source offsets.',loadedFiles:files.length,functionsObserved:files.reduce((n,f)=>n+f.functionsObserved,0),functionsExecuted:files.reduce((n,f)=>n+f.functionsExecuted,0),groups,files});
const watched=['src/loaders/FileLoader.js','src/loaders/ImageBitmapLoader.js','src/renderers/webgl/WebGLGeometries.js','src/renderers/webgl/WebGLBindingStates.js','src/renderers/WebGLRenderer.js','src/renderers/webgpu/utils/WebGPUAttributeUtils.js','src/animation/PropertyBinding.js','examples/jsm/loaders/GLTFLoader.js','examples/jsm/loaders/STLLoader.js','test/unit/src/nodes/tsl/gpu-test-utils.js','test/unit/src/nodes/tsl/gpu-raw-test-utils.js'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const devRef=process.env.AUDIT_DEV_REF??'f2b6a71bdd088d9da387fcc62802323341099b92';
const crosscheck=watched.map(file=>{const a=execFileSync('git',['show','r187:'+file],{cwd:repo}),b=execFileSync('git',['show',devRef+':'+file],{cwd:repo});return{file,releaseSha256:sha(a),devSha256:sha(b),identical:a.equals(b),diff:a.equals(b)?'':execFileSync('git',['diff','--unified=2','r187',devRef,'--',file],{cwd:repo,encoding:'utf8'})}});
await save('dev-crosscheck.json',{release:execFileSync('git',['rev-parse','r187^{commit}'],{cwd:repo,encoding:'utf8'}).trim(),development:execFileSync('git',['rev-parse',devRef],{cwd:repo,encoding:'utf8'}).trim(),files:crosscheck});
console.log(JSON.stringify({suites:suites.length,lint,coverage:{files:files.length,functions:[...coverage.values()].reduce((n,f)=>n+f.size,0),executed:[...coverage.values()].reduce((n,f)=>n+[...f.values()].filter(Boolean).length,0)}}));
