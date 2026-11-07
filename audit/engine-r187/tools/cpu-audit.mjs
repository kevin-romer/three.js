import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from './candidates.mjs';
const [repo, output] = process.argv.slice(2).map(value => resolve(value));
const T=await import(pathToFileURL(join(repo,'src/Three.js')));
const baseFile=join(repo,'src/objects/BatchedMesh.js');
const source=await readFile(baseFile,'utf8');
const heapFile=join(dirname(output),'BatchedMesh.heap.mjs');
await writeFile(heapFile,transform(source,'src/objects/BatchedMesh.js','free-id-heap').replace(/from '([^']+)'/g,
  (match,spec)=>spec.startsWith('.')?"from '"+pathToFileURL(resolve(dirname(baseFile),spec)).href+"'":match));
const {BatchedMesh:Heap}=await import(pathToFileURL(heapFile));
const runs=[];
const geometry=new T.BufferGeometry();
geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
const material=new T.MeshBasicMaterial();
for(let round=0;round<3;round++)for(const [version,Class] of round%2?[['heap',Heap],['upstream',T.BatchedMesh]]:[['upstream',T.BatchedMesh],['heap',Heap]]) {
 for(const count of [1024,4096,16384]) {
  const mesh=new Class(count,3,0,material),gid=mesh.addGeometry(geometry);
  for(let i=0;i<count;i++)mesh.addInstance(gid);
  const deleteBegin=performance.now();
  for(let i=count-1;i>=0;i--)mesh.deleteInstance(i);
  const deleteMs=performance.now()-deleteBegin;
  const begin=performance.now();
  for(let i=0;i<count;i++)assert.equal(mesh.addInstance(gid),i);
  const ms=performance.now()-begin;
  assert.equal(mesh.instanceCount,count);
  runs.push({version,round,count,deleteMs,refillMs:ms,cycleMs:deleteMs+ms});
  mesh.dispose();
 }
}
let random=913;
const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random;};
for(const Class of [T.BatchedMesh,Heap]) {
 const mesh=new Class(256,12,0,material),gid=mesh.addGeometry(geometry);
 const active=new Set();
 for(let step=0;step<2000;step++) {
  if(active.size && (active.size===256 || next()%2===0)) {
   const id=[...active][next()%active.size];mesh.deleteInstance(id);active.delete(id);
  } else {
   let expected=0;while(active.has(expected))expected++;
   const id=mesh.addInstance(gid);assert.equal(id,expected);active.add(id);
  }
 }
 for(const id of [...active])mesh.deleteInstance(id);
 mesh.setInstanceCount(8);
 assert.equal(mesh.instanceCount,0);
 const first=mesh.addInstance(gid);assert.equal(first,0);
 const clone=mesh.clone();assert.equal(clone.addInstance(gid),1);clone.dispose();
 const g1=mesh.addGeometry(geometry),g2=mesh.addGeometry(geometry);
 mesh.deleteGeometry(g2);mesh.deleteGeometry(g1);assert.equal(mesh.addGeometry(geometry),g1);
 mesh.dispose();
}
const uboCalls=[];
const gl={UNIFORM_BUFFER:35345,MAX_UNIFORM_BUFFER_BINDINGS:35375,
 getParameter:()=>24,createBuffer:()=>({}),bindBuffer(){},bufferData(){},deleteBuffer(){},
 bufferSubData(target,offset,array){uboCalls.push({offset,bytes:array.byteLength})}};
const {WebGLUniformsGroups}=await import(pathToFileURL(join(repo,'src/renderers/webgl/WebGLUniformsGroups.js')));
const info={render:{frame:0}},state={updateUBOMapping(){},uniformBlockBinding(){}};
const ubo=WebGLUniformsGroups(gl,info,{},state);
const group=new T.UniformsGroup();
for(let i=0;i<256;i++)group.add(new T.Uniform(new T.Vector4(i,0,0,1)));
ubo.update(group,{program:{}});uboCalls.length=0;
info.render.frame++;
for(const uniform of group.uniforms)uniform.value.x+=1;
ubo.update(group,{program:{}});
const dirtyUbo={uniforms:256,calls:uboCalls.length,bytes:uboCalls.reduce((a,v)=>a+v.bytes,0),storageBytes:group.__size};
assert.equal(dirtyUbo.calls,256);
uboCalls.length=0;info.render.frame++;ubo.update(group,{program:{}});
assert.equal(uboCalls.length,0);
const matrix={};
const matrixRoot=new T.Group();
for(let i=0;i<10000;i++){const object=new T.Object3D();object.position.x=i;matrixRoot.add(object)}
for(const automatic of [true,false]){
 matrixRoot.traverse(o=>o.matrixAutoUpdate=automatic);
 matrixRoot.updateMatrixWorld(true);
 let compositions=0,worldMultiplies=0;
 const compose=T.Matrix4.prototype.compose,multiply=T.Matrix4.prototype.multiplyMatrices;
 T.Matrix4.prototype.compose=function(...args){compositions++;return compose.apply(this,args)};
 T.Matrix4.prototype.multiplyMatrices=function(...args){worldMultiplies++;return multiply.apply(this,args)};
 try{matrixRoot.updateMatrixWorld();}finally{T.Matrix4.prototype.compose=compose;T.Matrix4.prototype.multiplyMatrices=multiply;}
 matrix[automatic?'default':'manualLocalMatrices']={nodes:10001,compositions,worldMultiplies};
}
const raycasts=[];
for(const count of [1024,16384]) {
 const instanced=new T.InstancedMesh(geometry,material,count),matrix=new T.Matrix4();
 for(let i=0;i<count;i++){matrix.makeTranslation(i===0?0:1000+i,0,0);instanced.setMatrixAt(i,matrix)}
 instanced.updateMatrixWorld(true);instanced.computeBoundingSphere();
 const raycaster=new T.Raycaster(new T.Vector3(.1,.1,5),new T.Vector3(0,0,-1));
 let meshTests=0;
 const original=T.Mesh.prototype.raycast;
 T.Mesh.prototype.raycast=function(...args){meshTests++;return original.apply(this,args)};
 try{
  const hits=[];instanced.raycast(raycaster,hits);
  assert.equal(meshTests,count);assert.equal(hits.length,1);assert.equal(hits[0].instanceId,0);
  raycasts.push({instances:count,meshTests,hits:hits.length});
 }finally{T.Mesh.prototype.raycast=original;instanced.dispose();}
}
const results={node:process.version,freeIdRefill:runs,randomizedOperationsPerClass:2000,dirtyUbo,matrix,raycasts};
await writeFile(output,JSON.stringify(results,null,2)+'\n');
console.table(runs);
console.log(JSON.stringify({dirtyUbo,matrix,raycasts},null,2));
geometry.dispose();material.dispose();
