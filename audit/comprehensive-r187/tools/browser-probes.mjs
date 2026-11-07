import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json')),{chromium}=require(process.env.PLAYWRIGHT_ROOT?resolve(process.env.PLAYWRIGHT_ROOT):'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const page=await browser.newPage({viewport:{width:512,height:512}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('https://engine-checks.test/**',async route=>{
 const name=decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//,'');
 if(!name){await route.fulfill({contentType:'text/html',body:'<!doctype html><script type="importmap">{"imports":{"three":"/src/Three.js","three/webgpu":"/src/Three.WebGPU.js","three/tsl":"/src/Three.TSL.js"}}</script>'});return}
 if(name.includes('..')){await route.abort();return}
 try{await route.fulfill({contentType:'text/javascript',body:await readFile(join(repo,name))})}catch{await route.fulfill({status:404,body:''})}
});
try{
 await page.goto('https://engine-checks.test/');
 const result=await page.evaluate(async()=>{
  const T=await import('/src/Three.js');
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
  const pixels=async renderer=>{
   const gl=renderer.getContext(),bytes=new Uint8Array(64*64*4);gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   let colored=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]||bytes[i+1]||bytes[i+2])colored++;
   return {colored,sha256:await digest(bytes),glError:gl.getError()};
  };
  const make=()=>{const canvas=document.createElement('canvas');document.body.append(canvas);const renderer=new T.WebGLRenderer({canvas,antialias:false});renderer.setSize(64,64,false);renderer.setClearColor(0);return renderer};
  const position=()=>new T.Float32BufferAttribute([-.2,-.2,0,.2,-.2,0,0,.2,0],3);
  const camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=5;
  const ownership=[];
  for(const shared of [false,true]){
   const r=make(),scene=new T.Scene(),a=new T.BufferGeometry(),b=new T.BufferGeometry(),p=position(),material=new T.MeshBasicMaterial({color:0x00ff00,side:T.DoubleSide});
   a.setAttribute('position',p);b.setAttribute('position',shared?p:position());
   const ma=new T.Mesh(a,material),mb=new T.Mesh(b,material);ma.position.x=-.4;mb.position.x=.4;scene.add(ma,mb);
   r.render(scene,camera);
   scene.remove(ma);r.render(scene,camera);const before=await pixels(r);
   a.dispose();b.attributes.position.needsUpdate=true;r.render(scene,camera);const after=await pixels(r);
   ownership.push({shared,before,after});
   b.dispose();material.dispose();r.dispose();r.forceContextLoss();r.domElement.remove();
  }
  const geometry=new T.BufferGeometry().setAttribute('position',position()),texture=new T.DataTexture(new Uint8Array([255,255,255,255]),1,1,T.RGBAFormat);texture.needsUpdate=true;
  const material=new T.MeshBasicMaterial({map:texture,color:0x00ff00}),scene=new T.Scene();scene.add(new T.Mesh(geometry,material));
  const subscriptions=[];
  for(let i=0;i<3;i++){
   const r=make();r.render(scene,camera);r.dispose();r.forceContextLoss();r.domElement.remove();
   subscriptions.push({cycle:i+1,geometry:geometry._listeners?.dispose?.length??0,material:material._listeners?.dispose?.length??0,texture:texture._listeners?.dispose?.length??0});
  }
  geometry.dispose();material.dispose();texture.dispose();
  const afterAssetDispose={geometry:geometry._listeners?.dispose?.length??0,material:material._listeners?.dispose?.length??0,texture:texture._listeners?.dispose?.length??0};

  let webgpu;
  try{
   const W=await import('/src/Three.WebGPU.js'),canvas=document.createElement('canvas');document.body.append(canvas);
   const renderer=new W.WebGPURenderer({canvas,antialias:false});await renderer.init();
   const backend=renderer.backend.isWebGPUBackend===true;
   const target=new W.RenderTarget(32,32),g=new W.PlaneGeometry(1,1),m=new W.MeshBasicNodeMaterial({color:0x00ff00,side:W.DoubleSide}),s=new W.Scene();s.add(new W.Mesh(g,m));
   renderer.setRenderTarget(target);renderer.render(s,camera);const bytes=await renderer.readRenderTargetPixelsAsync(target,0,0,32,32);
   let colored=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]||bytes[i+1]||bytes[i+2])colored++;
   webgpu={backend,pixelBytes:bytes.byteLength,colored,sha256:await digest(bytes),memory:{...renderer.info.memory}};
   renderer.setRenderTarget(null);target.dispose();g.dispose();m.dispose();renderer.dispose();canvas.remove();
  }catch(error){webgpu={error:String(error)}}

  const context=new OfflineAudioContext(1,128,44100);T.AudioContext.setContext(context);
  const listener=new T.AudioListener(),audio=new T.Audio(listener);audio.setBuffer(context.createBuffer(1,128,44100));audio.setLoop(true);audio.play();audio.pause();audio.play();audio.stop();audio.disconnect();listener.gain.disconnect();
  const audioState={isPlaying:audio.isPlaying,connected:audio._connected,hasEndedCallback:audio.source.onended!==null};

  const {OrbitControls}=await import('/examples/jsm/controls/OrbitControls.js');
  const canvas=document.createElement('canvas');document.body.append(canvas);
  const originalAdd=EventTarget.prototype.addEventListener,originalRemove=EventTarget.prototype.removeEventListener;
  const ids=new WeakMap();let serial=0;
  const id=object=>{if(!ids.has(object))ids.set(object,++serial);return ids.get(object)};
  const active=new Set(),key=(object,type,fn,options)=>id(object)+':'+type+':'+id(fn)+':'+Boolean(typeof options==='boolean'?options:options?.capture);
  EventTarget.prototype.addEventListener=function(type,fn,options){if(fn)active.add(key(this,type,fn,options));return originalAdd.call(this,type,fn,options)};
  EventTarget.prototype.removeEventListener=function(type,fn,options){if(fn)active.delete(key(this,type,fn,options));return originalRemove.call(this,type,fn,options)};
  let controlListeners;
  try{const controls=new OrbitControls(camera,canvas);controls.listenToKeyEvents(window);const before=active.size;controls.dispose();controlListeners={before,after:active.size}}
  finally{EventTarget.prototype.addEventListener=originalAdd;EventTarget.prototype.removeEventListener=originalRemove;canvas.remove()}
  return {ownership,subscriptions,afterAssetDispose,webgpu,audioState,controlListeners};
 });
 const record={browser:browser.version(),...result,pageErrors:errors};
 await writeFile(join(out,'browser-probes.json'),JSON.stringify(record,null,2)+'\n');
 assert.equal(result.ownership[0].after.sha256,result.ownership[0].before.sha256);
 assert.equal(result.audioState.isPlaying,false);assert.equal(result.audioState.connected,false);assert.equal(result.controlListeners.after,0);
 console.log(JSON.stringify(record,null,2));
}finally{await page.close();await browser.close()}
