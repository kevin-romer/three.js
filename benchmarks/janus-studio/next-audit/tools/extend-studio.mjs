import {readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const [app,three,out,stage='e02-frozen']=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const require=createRequire(join(app,'package.json'));
const declaration=JSON.parse(await readFile(join(out,stage+'-extension-declaration.json')));assert.deepEqual(declaration.pairNumbers,[6,7,8,9,10]);
const initial=JSON.parse(await readFile(join(out,stage+'-studio-timing-pair1-control.json'))),protocol=initial.protocol,controllerSha256=sha(await readFile(fileURLToPath(import.meta.url)));
async function check(){
 for(const [name,h]of Object.entries(protocol.tools))assert.equal(sha(await readFile(join(root,name))),h);
 for(const x of Object.values(protocol.engine))for(const [name,h]of Object.entries(x.sources))assert.equal(sha(execFileSync('git',['show',x.ref+':'+name],{cwd:three})),h);
 const manifest=JSON.parse(await readFile(join(out,'private-app-source-manifest.json')));for(const [name,h]of Object.entries(manifest.sourceFiles))assert.equal(sha(await readFile(join(app,name))),h);
 assert.equal(process.versions.node,protocol.node);
 for(const [name,metadata]of Object.entries(protocol.runtimeDependencies)){let bytes;try{bytes=await readFile(require.resolve(name+'/package.json'))}catch{let dir=dirname(require.resolve(name));while(true){try{const b=await readFile(join(dir,'package.json'));if(JSON.parse(b).name===name){bytes=b;break}}catch{}if(dirname(dir)===dir)throw Error('No package manifest '+name);dir=dirname(dir)}}assert.equal(sha(bytes),metadata.packageJsonSha256);}
}
for(const pair of declaration.pairNumbers)for(const variant of pair%2?['control','candidate']:['candidate','control']){
 await check();const label=`${stage}-studio-timing-pair${pair}-${variant}`;
 await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'studio-synthetic.mjs'),app,three,out,variant],{env:{...process.env,BENCH_ENGINE_REF:protocol.engine[variant].ref,BENCH_RUN:JSON.stringify({label,frames:300,warmup:120,correctness:true,diagnostics:false})},stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{const s=b.toString();log+=s;if(!s.startsWith('RESULT'))process.stdout.write(s)});child.on('error',reject);child.on('exit',async c=>{await writeFile(join(out,label+'.log'),log);c===0?resolve():reject(Error(label+' exited '+c))})});
 await check();const record=JSON.parse(await readFile(join(out,label+'.json')));assert.deepEqual(record.appSources,initial.appSources);record.protocol={...protocol,extensionControllerSha256:controllerSha256};await writeFile(join(out,label+'.json'),JSON.stringify(record,null,2));
 console.log('EXTENSION_MEMBER',label,record.result.metrics.engineMs.p95);
 if(variant===(pair%2?'candidate':'control')){const a=JSON.parse(await readFile(join(out,`${stage}-studio-timing-pair${pair}-control.json`))),b=JSON.parse(await readFile(join(out,`${stage}-studio-timing-pair${pair}-candidate.json`)));assert.deepEqual(a.result.pixels,b.result.pixels);assert.deepEqual(a.result.summaries.map(x=>[x.draws,x.triangles,x.renderCalls]),b.result.summaries.map(x=>[x.draws,x.triangles,x.renderCalls]));assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);console.log('EXTENSION_PAIR_PASSED',pair)}
}
await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'analyze-next.mjs'),out,stage,'studio','10'],{stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error('Extended analysis failed '+c)))});
