import {startJanusServer} from './janus-lifetime-server.mjs';
import {rememberBrowser,finishBrowser} from './managed-browser.mjs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const [appArg,threeArg,outArg,variant]=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),require=createRequire(join(app,'package.json')),{chromium}=require('playwright');
const {server,origin}=await startJanusServer({app,three,out,variant});let browser,browserServer,succeeded=false;
try{
 browserServer=await chromium.launchServer({host:'127.0.0.1',channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});await rememberBrowser(browserServer,out);browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/__three_bench');await page.waitForFunction(()=>globalThis.__benchReady);
 const initial=await page.evaluate(async()=>{
  const T=await import('/@id/__x00__three-benchmark');globalThis.__gcProbe={};
  const camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;
  {
   const r=new T.WebGLRenderer(),s=new T.Scene(),g=new T.PlaneGeometry(2,2),m=new T.MeshBasicMaterial({color:0x00ff00});r.setSize(8,8);s.add(new T.Mesh(g,m));r.render(s,camera);
   const gl=r.getContext(),bytes=new Uint8Array(4);gl.readPixels(4,4,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
   Object.assign(__gcProbe,{retainedMaterial:m,retainedGeometry:g,rendererWeak:new WeakRef(r),pixel:Array.from(bytes),glError:gl.getError()});r.dispose();r.forceContextLoss();
  }
  {
   const r=new T.WebGLRenderer(),s=new T.Scene(),g=new T.PlaneGeometry(2,2),m=new T.MeshBasicMaterial();r.setSize(8,8);s.add(new T.Mesh(g,m));r.render(s,camera);s.clear();r.render(s,camera);g.dispose();
   Object.assign(__gcProbe,{liveRenderer:r,unusedMaterialWeak:new WeakRef(m)});
  }
  return{pixel:__gcProbe.pixel,glError:__gcProbe.glError};
 });
 const cdp=await page.context().newCDPSession(page);for(let i=0;i<3;i++){await cdp.send('HeapProfiler.collectGarbage');await page.waitForTimeout(100)}
 const result=await page.evaluate(()=>({disposedRendererStillReachable:!!__gcProbe.rendererWeak.deref(),retainedMaterialDisposeListeners:__gcProbe.retainedMaterial._listeners?.dispose?.length??0,unusedMaterialStillReachable:!!__gcProbe.unusedMaterialWeak.deref()}));
 await page.evaluate(()=>{__gcProbe.retainedMaterial.dispose();__gcProbe.retainedGeometry.dispose();__gcProbe.liveRenderer.dispose();__gcProbe.liveRenderer.forceContextLoss();delete globalThis.__gcProbe});
 await writeFile(join(out,'engine-lifetime-gc-'+variant+'.json'),JSON.stringify({variant,sourceRef:process.env.BENCH_ENGINE_REF,browser:browser.version(),scope:'Targeted renderer/material reachability after explicit Chrome GC; not a retained-heap byte or production memory benchmark.',initial,result,errors},null,2));console.log(JSON.stringify({variant,initial,result,errors}));succeeded=true;
}finally{await finishBrowser({browser,browserServer,vite:server,succeeded})}
