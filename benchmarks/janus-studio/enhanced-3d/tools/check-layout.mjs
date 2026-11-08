import {writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repoArg,outArg,control='9c6f26bb55e83416541009ac1444ba611b9a05b1',candidate='e48c8880d9daf3e3e1c16bf890b69d4bdf1fc335']=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
await mkdir(out,{recursive:true});
let original=execFileSync('git',['show',control+':src/renderers/webgl/WebGLPrograms.js'],{cwd:repo,encoding:'utf8'});
original=original.replace(/from '([^']+)'/g,(_,name)=>`from '${pathToFileURL(resolve(repo+'/src/renderers/webgl',name))}'`);
await writeFile(join(out,'layout-baseline.mjs'),original);
let modified=execFileSync('git',['show',candidate+':src/renderers/webgl/WebGLPrograms.js'],{cwd:repo,encoding:'utf8'});
modified=modified.replace(/from '([^']+)'/g,(_,name)=>`from '${pathToFileURL(resolve(repo+'/src/renderers/webgl',name))}'`);
await writeFile(join(out,'layout-candidate.mjs'),modified);
const {WebGLPrograms:Before}=await import(pathToFileURL(join(out,'layout-baseline.mjs')));
const {WebGLPrograms:After}=await import(pathToFileURL(join(out,'layout-candidate.mjs')));
const T=await import(pathToFileURL(repo+'/src/Three.js'));
const renderer={getRenderTarget:()=>null,state:{buffers:{depth:{getReversed:()=>false}}},outputColorSpace:T.SRGBColorSpace,toneMapping:T.ACESFilmicToneMapping,shadowMap:{enabled:true,type:1}};
const capabilities={precision:'highp',logarithmicDepthBuffer:false,getMaxPrecision:v=>v};
const lights={sun:[],directional:[{}],point:[{},{}],spot:[],spotLightMap:[],rectArea:[],hemi:[],sunShadowMap:[],directionalShadowMap:[],pointShadowMap:[],spotShadowMap:[],numSpotLightShadowsWithMaps:0,numLightProbes:1};
const geometry=new T.PlaneGeometry(),scene=new T.Scene(),object={geometry},grids=[{texture:null},{texture:{}}];
const caches=[Before,After].map(C=>new C(renderer,{get:()=>null},{has:()=>false},capabilities,{}, {numPlanes:3,numIntersection:1},16));
let checked=0;
for(const type of ['MeshBasicMaterial','MeshStandardMaterial','MeshPhysicalMaterial','MeshLambertMaterial','MeshPhongMaterial','PointsMaterial','ShaderMaterial','RawShaderMaterial'])for(const features of [false,true]) {
 const material=new T[type]();
 if(features){material.map=new T.Texture();material.map.channel=2;material.normalMap=new T.Texture();material.vertexColors=true;material.alphaTest=.2;material.side=T.DoubleSide;material.transparent=true;material.clipping=true;material.transmission=.7;material.transmissionMap=new T.Texture();}
 const records=caches.map(c=>c.getParameters(material,lights,[{}],scene,object,grids));
 assert.deepEqual(Object.keys(records[0]),Object.keys(records[1]));
 for(const r of records){assert.equal(Object.getPrototypeOf(r),Object.prototype);for(const k of ['customVertexShaderID','customFragmentShaderID','customVertexShaderStage','customFragmentShaderStage'])delete r[k];}
 assert.deepEqual(records[0],records[1]);checked++;
}
const material=new T.ShaderMaterial();
const shapes=caches.map(c=>%HasFastProperties(c.getParameters(material,lights,[],scene,object,grids)));
const result={node:process.version,control,candidate,checked,scope:'Node/V8 shape diagnostic and sixteen material-state equivalence checks; not a browser timing result. Custom shader stage identities are cache-local and normalized for record comparison.',fastProperties:{control:shapes[0],candidate:shapes[1]}};
await writeFile(join(out,'layout-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
assert.deepEqual(shapes,[false,true]);
