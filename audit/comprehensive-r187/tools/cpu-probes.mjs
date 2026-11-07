import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const T=await import(pathToFileURL(join(repo,'src/Three.js')));
if(!globalThis.ProgressEvent)globalThis.ProgressEvent=class extends Event{constructor(type,options){super(type);Object.assign(this,options)}};
const originalFetch=globalThis.fetch,originalBitmap=globalThis.createImageBitmap;
const results={node:process.version};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
try{
 T.Cache.enabled=false;T.Cache.clear();
 const requests=[];
 globalThis.fetch=async request=>{requests.push({url:request.url,scope:request.headers.get('X-Audit-Scope')});await tick();return new Response(request.headers.get('X-Audit-Scope')??'sample')};
 const a=new T.FileLoader().setResponseType('arraybuffer'),b=new T.FileLoader();
 const [first,second]=await Promise.all([a.loadAsync('https://audit.invalid/type'),b.loadAsync('https://audit.invalid/type')]);
 results.fileResponseTypes={fetches:requests.length,first:first.constructor.name,second:second.constructor.name,expectedSecond:'String'};
 assert(second instanceof ArrayBuffer);assert.equal(requests.length,1);await tick();
 requests.length=0;
 const scopeA=new T.FileLoader().setRequestHeader({'X-Audit-Scope':'scope-A'}),scopeB=new T.FileLoader().setRequestHeader({'X-Audit-Scope':'scope-B'});
 const values=await Promise.all([scopeA.loadAsync('https://audit.invalid/scope'),scopeB.loadAsync('https://audit.invalid/scope')]);
 results.fileRequestIsolation={fetches:requests.length,requested:['scope-A','scope-B'],received:values};
 assert.deepEqual(values,['scope-A','scope-A']);await tick();
 globalThis.createImageBitmap=async(blob,options)=>({...options});
 globalThis.fetch=async()=>{await tick();return new Response(new Blob(['synthetic']))};
 const bitmapLoader=new T.ImageBitmapLoader().setOptions({imageOrientation:'none'});
 const imageA=bitmapLoader.loadAsync('https://audit.invalid/image-A');
 bitmapLoader.setOptions({imageOrientation:'flipY'});
 const imageB=bitmapLoader.loadAsync('https://audit.invalid/image-B');
 const images=await Promise.all([imageA,imageB]);
 results.bitmapOptionsRace={requested:['none','flipY'],received:images.map(image=>image.imageOrientation)};
 assert.deepEqual(results.bitmapOptionsRace.received,['flipY','flipY']);await tick();
}finally{globalThis.fetch=originalFetch;if(originalBitmap===undefined)delete globalThis.createImageBitmap;else globalThis.createImageBitmap=originalBitmap;T.Cache.enabled=false;T.Cache.clear()}

const {default:WebGPUAttributeUtils}=await import(pathToFileURL(join(repo,'src/renderers/webgpu/utils/WebGPUAttributeUtils.js')));
const records=new WeakMap(),writes=[];
const backend={getBufferAttribute:a=>a,get:a=>records.get(a),device:{queue:{writeBuffer(buffer,offset,data,dataOffset=0,size){
 const unit=ArrayBuffer.isView(data)?data.BYTES_PER_ELEMENT:1;
 const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);
 const length=size===undefined?bytes.byteLength-dataOffset*unit:size*unit;
 buffer.set(bytes.subarray(dataOffset*unit,dataOffset*unit+length),offset);
 writes.push({offset,bytes:length});
}}}};
const utils=new WebGPUAttributeUtils(backend);
const sparse=new T.BufferAttribute(new Uint8Array(100000*3).fill(1),3);
let allocated=0,views=0;
const CountingArray=new Proxy(Uint8Array,{construct(target,args){if(typeof args[0]==='number')allocated+=args[0];else views++;return Reflect.construct(target,args)}});
Object.defineProperty(sparse.array,'constructor',{value:CountingArray});
records.set(sparse,{buffer:new Uint8Array(100000*4),_itemSize:3,_paddedItemSize:4});
sparse.addUpdateRange(3*50000+1,1);utils.updateAttribute(sparse);
results.webgpuPadding={vertices:100000,dirtyComponents:1,newCpuBytes:allocated,subarrayViews:views,gpuWrites:writes.length,gpuBytes:writes.reduce((n,v)=>n+v.bytes,0)};
assert.equal(allocated,400000);assert.equal(views,100000);assert.equal(results.webgpuPadding.gpuBytes,4);
writes.length=0;
const repeated=new T.BufferAttribute(new Float32Array(16),4);
records.set(repeated,{buffer:new Uint8Array(64)});
for(let i=0;i<256;i++)repeated.addUpdateRange(0,4);
utils.updateAttribute(repeated);
results.webgpuOverlappingRanges={dirtyRanges:256,uniqueBytes:16,writeCalls:writes.length,submittedBytes:writes.reduce((n,v)=>n+v.bytes,0)};
assert.equal(writes.length,256);assert.equal(results.webgpuOverlappingRanges.submittedBytes,4096);
let seed=1448;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed};
for(let trial=0;trial<500;trial++){
 const Type=trial%2?Uint16Array:Uint8Array,len=1+random()%63,owner=new Type(len+5),array=new Type(owner.buffer,Type.BYTES_PER_ELEMENT,len);
 for(let i=0;i<len;i++)array[i]=random()&(Type===Uint8Array?255:65535);
 const gpu=new Uint8Array(Math.ceil(array.byteLength/4)*4);gpu.set(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
 const start=random()%len,count=1+random()%(len-start);
 for(let i=start;i<start+count;i++)array[i]=random()&(Type===Uint8Array?255:65535);
 const attribute=new T.BufferAttribute(array,1);records.set(attribute,{buffer:gpu});attribute.addUpdateRange(start,count);utils.updateAttribute(attribute);
 assert.deepEqual(gpu.slice(0,array.byteLength),new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
}
results.webgpuAlignedFuzz={trials:500,types:['Uint8Array','Uint16Array'],nonzeroViewOffsets:true,status:'passed'};

const root=new T.Group(),objects=[];
let namesRead=0;
for(let i=0;i<10000;i++){const object=new T.Object3D();const name='node_'+i;Object.defineProperty(object,'name',{get(){namesRead++;return name}});objects.push(object);root.add(object)}
const tracks=[];
for(let i=9000;i<10000;i++)tracks.push(new T.VectorKeyframeTrack('node_'+i+'.position',[0,1],[0,0,0,1,1,1]));
const clip=new T.AnimationClip('scene',1,tracks),mixer=new T.AnimationMixer(root);
namesRead=0;mixer.clipAction(clip).play();
const coldReads=namesRead;namesRead=0;mixer.update(.5);const warmReads=namesRead;
assert.equal(objects[9000].position.x,.5);
mixer.stopAllAction();mixer.uncacheRoot(root);
results.animation={nodes:10000,tracks:1000,coldBindingNameReads:coldReads,warmUpdateNameReads:warmReads,afterUncache:{actions:mixer.stats.actions.total,bindings:mixer.stats.bindings.total}};
assert(coldReads>9000000);assert.equal(warmReads,0);assert.equal(mixer.stats.actions.total,0);assert.equal(mixer.stats.bindings.total,0);

const {GLTFLoader}=await import(pathToFileURL(join(repo,'examples/jsm/loaders/GLTFLoader.js')));
const count=65535,viewBytes=count*3*4,bin=new Uint8Array(viewBytes*2),floats=new Float32Array(bin.buffer);
for(let i=0;i<count;i++){floats[i*3]=i%3===1?1:0;floats[i*3+1]=i%3===2?1:0;floats[viewBytes/4+i*3+2]=1}
const json={asset:{version:'2.0'},buffers:[{byteLength:bin.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:viewBytes},{buffer:0,byteOffset:viewBytes,byteLength:viewBytes}],accessors:[{bufferView:0,componentType:5126,count,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count,type:'VEC3'}],meshes:[{primitives:[{attributes:{POSITION:0,NORMAL:1}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
const text=new TextEncoder().encode(JSON.stringify(json)),jsonLength=Math.ceil(text.length/4)*4;
const glb=new ArrayBuffer(12+8+jsonLength+8+bin.byteLength),dv=new DataView(glb),raw=new Uint8Array(glb);
dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,glb.byteLength,true);dv.setUint32(12,jsonLength,true);dv.setUint32(16,0x4e4f534a,true);raw.fill(32,20,20+jsonLength);raw.set(text,20);
const chunk=20+jsonLength;dv.setUint32(chunk,bin.byteLength,true);dv.setUint32(chunk+4,0x004e4942,true);raw.set(bin,chunk+8);
const originalSlice=ArrayBuffer.prototype.slice,slices=[];
ArrayBuffer.prototype.slice=function(...args){const value=originalSlice.apply(this,args);slices.push({inputBytes:this.byteLength,copyBytes:value.byteLength});return value};
try{
 const parsed=await new GLTFLoader().parseAsync(glb,'');
 assert.equal(parsed.scene.children[0].geometry.attributes.position.count,count);
 results.gltfCopies={inputBytes:glb.byteLength,binBytes:bin.byteLength,vertices:count,slices,totalCopiedBytes:slices.reduce((n,v)=>n+v.copyBytes,0)};
 parsed.scene.children[0].geometry.dispose();parsed.scene.children[0].material.dispose();
}finally{ArrayBuffer.prototype.slice=originalSlice}

const {STLLoader}=await import(pathToFileURL(join(repo,'examples/jsm/loaders/STLLoader.js')));
const stl=new ArrayBuffer(84);new DataView(stl).setUint32(80,1000000,true);
const Float=globalThis.Float32Array;let attempted;
globalThis.Float32Array=new Proxy(Float,{construct(target,args){if(typeof args[0]==='number'&&args[0]>1000000){attempted=args[0]*4;throw new Error('AUDIT_ALLOCATION_GUARD')}return Reflect.construct(target,args)}});
try{new STLLoader().parse(stl);assert.fail('Expected the guarded declared-size allocation')}
catch(error){assert.equal(error.message,'AUDIT_ALLOCATION_GUARD');results.stlPreflight={inputBytes:84,declaredTriangles:1000000,attemptedFloatAllocationBytes:attempted,actualLargeAllocationPrevented:true}}
finally{globalThis.Float32Array=Float}
await writeFile(join(out,'cpu-probes.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
