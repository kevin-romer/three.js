import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repoArg,outArg,control,candidate]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg),refs={control,candidate},sources={},classes={};await mkdir(out,{recursive:true});
for(const variant of ['control','candidate']){
 const source=refs[variant]==='WORKTREE'?await readFile(join(repo,'src/math/Matrix4.js'),'utf8'):execFileSync('git',['show',refs[variant]+':src/math/Matrix4.js'],{cwd:repo,encoding:'utf8'});
 sources[variant]={commit:refs[variant],sha256:createHash('sha256').update(source).digest('hex')};
 const code=source.replace(/from '([^']+)'/g,(_,name)=>`from '${pathToFileURL(resolve(repo,'src/math',name))}'`),file=join(out,variant+'-matrix-module.mjs');await writeFile(file,code);classes[variant]=(await import(pathToFileURL(file))).Matrix4;
}
let seed=20261108;const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296},pick=a=>a[Math.floor(random()*a.length)],digest=createHash('sha256');let comparisons=0,exceptions=0;
const encode=(k,v)=>typeof v==='number'?(Object.is(v,-0)?'number:-0':Number.isNaN(v)?'number:NaN':!Number.isFinite(v)?'number:'+v:v):v;
for(let i=0;i<5000;i++){
 const values=Array.from({length:16},()=>pick([0,-0,NaN,Infinity,-Infinity,(random()-.5)*1e9]));
 const offset=i%101===0?2n:pick([undefined,0,2,-1,null,1.5,'0',NaN]);
 for(const defaultOutput of [true,false]){
  const outputs=[];
  for(const variant of ['control','candidate']){
   const m=new classes[variant](),events=[];
   let elements=i%5===0?new Float32Array(values):i%5===1?new Float64Array(values):i%5===2?values.slice():i%5===3?Object.fromEntries(values.map((v,k)=>[k,v])):new Array(16);
   if(i%5===4)for(let k=0;k<16;k+=2)elements[k]=values[k];
   if(i%13===0)elements=new Proxy(elements,{get(t,k){events.push('get:'+String(k));return Reflect.get(t,k)}});
   m.elements=elements;
   let target;
   if(!defaultOutput){switch(i%6){case 0:target=undefined;break;case 1:target=[];break;case 2:target=new Float32Array(24).fill(-3);break;case 3:target=new Float64Array(24).fill(-3);break;case 4:target={};break;case 5:target=new Proxy([],{set(t,k,v){events.push('set:'+String(k));return Reflect.set(t,k,v)}});break}}
   let result,error;try{result=defaultOutput?m.toArray():m.toArray(target,offset)}catch(e){error=e.name}
   if(target!==undefined&&!error)assert.equal(result,target);
   const value=result??target;
   const snapshot=value===undefined?null:{kind:ArrayBuffer.isView(value)?value.constructor.name:Array.isArray(value)?'Array':'Object',descriptors:Object.getOwnPropertyDescriptors(value)};
   outputs.push({error,snapshot,events});
  }
  assert.deepEqual(outputs[1],outputs[0],'Mismatch at case '+i+' default '+defaultOutput);digest.update(JSON.stringify(outputs[0],encode)+'\n');comparisons++;if(outputs[0].error)exceptions++;
 }
}
assert.equal(classes.control.prototype.toArray.length,classes.candidate.prototype.toArray.length);
const record={node:process.version,scope:'Actual baseline/candidate Matrix4 methods; deterministic value, type, descriptor, ownership, indexed-access order and exception comparison. Includes sparse/typed/array-like sources, supplied buffers and unusual offsets; not a timing result.',seed:20261108,cases:5000,comparisons,exceptions,resultSha256:digest.digest('hex'),sources};await writeFile(join(out,'matrix-equivalence.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
