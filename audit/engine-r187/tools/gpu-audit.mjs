import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from './candidates.mjs';
const [repoArg, playwrightArg, outputArg]=process.argv.slice(2);
const repo=resolve(repoArg),output=resolve(outputArg);
const {chromium}=await import(pathToFileURL(join(resolve(playwrightArg),'index.mjs')));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const sourceCache=new Map(),results=[];
try {
 for(const kind of ['hidden','sparse','indirect','resize','rows'])for(const variant of (kind==='hidden'?['upstream','hidden-material']:kind==='sparse'?['upstream','sparse-batch']:kind==='indirect'?['upstream','stable-indirect']:kind==='resize'?['upstream','resize-batch']:['upstream'])) {
  const page=await browser.newPage({viewport:{width:512,height:512}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://three-engine-audit.test/**',async route=>{
   const pathname=decodeURIComponent(new URL(route.request().url()).pathname);
   if(pathname==='/'){await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Three.js engine probe</title>'});return;}
   const file=pathname.replace(/^\//,'');
   if(!file.startsWith('src/')||file.includes('..')){await route.abort();return}
   if(!sourceCache.has(file))sourceCache.set(file,await readFile(join(repo,file),'utf8'));
   await route.fulfill({contentType:extname(file)==='.js'?'text/javascript':'text/plain',body:transform(sourceCache.get(file),file,variant)});
  });
  try {
   await page.goto('https://three-engine-audit.test/');
   const result=await page.evaluate(async ({kind,variant})=>{
    const T=await import('/src/Three.js');
    const canvas=document.createElement('canvas');document.body.append(canvas);
    const gl=canvas.getContext('webgl2',{antialias:false});
    const debug=gl.getExtension('WEBGL_debug_renderer_info');
    const gpu=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null;
    const trace={buffers:[],textures:[]};
    const original={};
    for(const method of ['bufferData','bufferSubData','texSubImage2D']){
     original[method]=gl[method].bind(gl);
     gl[method]=function(...args){
      if(method==='bufferData')trace.buffers.push({method,bytes:typeof args[1]==='number'?args[1]:args[1].byteLength});
      if(method==='bufferSubData')trace.buffers.push({method,bytes:args[4]!==undefined?args[4]*args[2].BYTES_PER_ELEMENT:args[2].byteLength});
      if(method==='texSubImage2D'&&args.length>=9){
       const [target,level,x,y,width,height,format,type]=args;
       const channels=format===gl.RGBA?4:format===gl.RGB?3:format===gl.RG?2:1;
       const componentBytes=type===gl.FLOAT||type===gl.UNSIGNED_INT||type===gl.INT?4:type===gl.UNSIGNED_SHORT||type===gl.HALF_FLOAT?2:1;
       trace.textures.push({width,height,format,type,bytes:width*height*channels*componentBytes});
      }
      return original[method](...args);
     };
    }
    const renderer=new T.WebGLRenderer({canvas,context:gl,antialias:false});
    renderer.setSize(512,512,false);renderer.setClearColor(0);
    const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,100);
    camera.position.z=5;camera.updateMatrixWorld();
    const reset=()=>{trace.buffers=[];trace.textures=[]};
    const copy=()=>JSON.parse(JSON.stringify(trace));
    const geometry=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([-.1,-.1,0,.1,-.1,0,0,.1,0],3));
    const material=new T.MeshBasicMaterial({color:0xffffff,side:T.DoubleSide});
    const frames=[],tests={};
    const hashPixels=async()=>{
     const bytes=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
     let hash=2166136261,colored=0;
     for(let i=0;i<bytes.length;i++){hash=Math.imul(hash^bytes[i],16777619)>>>0;if(i%4===0&&(bytes[i]||bytes[i+1]||bytes[i+2]))colored++}
     const digest=await crypto.subtle.digest('SHA-256',bytes);
     const sha256=Array.from(new Uint8Array(digest),value=>value.toString(16).padStart(2,'0')).join('');
     return {hash,sha256,colored};
    };
    let batch;
    try {
     if(kind==='hidden'){
      const hiddenMaterial=new T.MeshBasicMaterial({visible:false}),hidden=[];
      for(let i=0;i<128;i++){
       const data=new Float32Array(256*9);
       for(let j=0;j<256;j++)data.set(geometry.attributes.position.array,j*9);
       const mesh=new T.Mesh(new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(data,3)),hiddenMaterial);
       mesh.frustumCulled=false;hidden.push(mesh);scene.add(mesh);
      }
      hidden[0].add(new T.Mesh(geometry,material));
      reset();renderer.render(scene,camera);tests.cold=copy();
      for(let i=0;i<8;i++){
       for(const mesh of hidden)mesh.geometry.attributes.position.needsUpdate=true;
       reset();const start=performance.now();renderer.render(scene,camera);frames.push({cpuMs:performance.now()-start,...copy()});
      }
      tests.drawCalls=renderer.info.render.calls;tests.pixels=await hashPixels();tests.geometries=renderer.info.memory.geometries;
      // Revealing a previously hidden material must upload the deferred geometry.
      hiddenMaterial.visible=true;reset();renderer.render(scene,camera);tests.reveal=copy();tests.revealDrawCalls=renderer.info.render.calls;
      for(const mesh of hidden)mesh.geometry.dispose();hiddenMaterial.dispose();
     }else if(kind==='sparse'||kind==='indirect'||kind==='resize'){
      const capacity=kind==='sparse'?16384:kind==='resize'?256:4096;
      batch=new T.BatchedMesh(capacity,3,0,material);batch.frustumCulled=false;
      const gid=batch.addGeometry(geometry),matrix=new T.Matrix4();
      for(let i=0;i<capacity;i++){
       batch.addInstance(gid);matrix.makeTranslation(i<16?(i%4-.5)*.3:1000+i, i<16?(Math.floor(i/4)-.5)*.3:0,0);
       batch.setMatrixAt(i,matrix);
      }
      batch.setColorAt(0,new T.Color(1,1,1));scene.add(batch);
      renderer.render(scene,camera);renderer.render(scene,camera);
      if(kind==='resize'){
       batch.setColorAt(0,new T.Color(0,1,0));renderer.render(scene,camera);tests.pixels=await hashPixels();
       const clone=batch.clone();scene.remove(batch);scene.add(clone);clone.setInstanceCount(capacity+16);
       clone.setColorAt(0,new T.Color(0,1,0));renderer.render(scene,camera);tests.cloneGrowPixels=await hashPixels();
       clone.dispose();scene.remove(clone);scene.add(batch);
      }else if(kind==='sparse'){
       for(let i=0;i<8;i++){
        matrix.makeTranslation(-.15+i*.001,-.15,0);batch.setMatrixAt(0,matrix);batch.setColorAt(0,new T.Color(i%2?0:1,i%2?1:0,0));
        reset();const start=performance.now();renderer.render(scene,camera);frames.push({cpuMs:performance.now()-start,...copy()});
       }
       tests.pixels=await hashPixels();
       // Clone, grow, mutate before its first upload: untouched instances must retain data.
       const clone=batch.clone();scene.remove(batch);scene.add(clone);clone.setInstanceCount(capacity+16);
       clone.setColorAt(0,new T.Color(0,1,0));
       renderer.render(scene,camera);tests.cloneGrowPixels=await hashPixels();clone.dispose();scene.remove(clone);scene.add(batch);
      }else{
       for(let i=0;i<8;i++){
        reset();const start=performance.now();renderer.render(scene,camera);frames.push({cpuMs:performance.now()-start,...copy()});
       }
       tests.pixels=await hashPixels();
       batch.customSort=list=>list.sort((a,b)=>b.index-a.index);
       reset();renderer.render(scene,camera);tests.reordered=copy();
       tests.reorderedIds=Array.from(batch._indirectTexture.image.data.slice(0,batch._multiDrawCount));
       batch.setVisibleAt(15,false);renderer.render(scene,camera);tests.visibleCount=batch._multiDrawCount;
      }
      tests.capacity=capacity;tests.matrixWidth=batch._matricesTexture.image.width;tests.colorWidth=batch._colorsTexture.image.width;tests.indirectWidth=batch._indirectTexture.image.width;
      tests.drawCalls=renderer.info.render.calls;
     }else{
      const data=new Uint8Array(4*4*4).fill(255);
      const texture=new T.DataTexture(data,4,4,T.RGBAFormat);texture.needsUpdate=true;
      renderer.initTexture(texture);gl.getError();
      data.fill(0,0,32);texture.addUpdateRange(0,32);texture.needsUpdate=true;
      reset();renderer.initTexture(texture);tests.upload=copy();tests.glError=gl.getError();
      texture.dispose();
     }
     const glError=gl.getError();
     return {kind,variant,revision:T.REVISION,gpu,multiDraw:!!gl.getExtension('WEBGL_multi_draw'),frames,tests,glError};
    }finally{batch?.dispose();geometry.dispose();material.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();}
   },{kind,variant});
   assert.deepEqual(errors,[]);assert.equal(result.glError,0);assert(result.gpu);assert.doesNotMatch(result.gpu,/SwiftShader|llvmpipe/);
   results.push(result);
   const f=result.frames[0];
   console.log(kind,variant,JSON.stringify({bufferBytes:f?.buffers.reduce((a,x)=>a+x.bytes,0),textureBytes:f?.textures.reduce((a,x)=>a+x.bytes,0),pixels:result.tests.pixels,cloneGrowPixels:result.tests.cloneGrowPixels,glError:result.tests.glError}));
  }finally{await page.close()}
 }
 for(const kind of ['hidden','sparse','indirect','resize']){
  const [a,b]=results.filter(row=>row.kind===kind);
  assert.deepEqual(a.tests.pixels,b.tests.pixels);
  assert(a.tests.pixels.colored>100);
  if(kind==='hidden'){assert.equal(b.tests.drawCalls,1);assert.equal(b.tests.revealDrawCalls,129);assert.equal(b.frames[0].buffers.length,0);}
  if(kind==='sparse'||kind==='resize'){assert.equal(a.tests.cloneGrowPixels.colored,0);assert.deepEqual(b.tests.pixels,b.tests.cloneGrowPixels);}
  if(kind==='indirect'){assert.deepEqual(a.tests.reorderedIds,b.tests.reorderedIds);assert.equal(b.tests.visibleCount,15);assert(b.tests.reordered.textures.length>0);}
 }
 await writeFile(output,JSON.stringify({browser:browser.version(),node:process.version,results},null,2)+'\n');
}finally{await browser.close()}
