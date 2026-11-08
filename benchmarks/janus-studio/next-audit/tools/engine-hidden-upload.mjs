import {startJanusServer} from './janus-server.mjs';
import {rememberBrowser,finishBrowser} from './managed-browser.mjs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const [appArg,threeArg,outArg,variant]=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),require=createRequire(join(app,'package.json')),{chromium}=require('playwright');
const {server,origin}=await startJanusServer({app,three,out,variant});let browser,browserServer,succeeded=false;
try{
 browserServer=await chromium.launchServer({host:'127.0.0.1',channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});await rememberBrowser(browserServer,out);browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage();await page.goto(origin+'/__three_bench');await page.waitForFunction(()=>globalThis.__benchReady);
 const result=await page.evaluate(async()=>{
  const T=await import('/@id/__x00__three-benchmark'),r=new T.WebGLRenderer(),scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,10);camera.position.z=2;r.setSize(16,16);
  const hidden=[];for(let i=0;i<128;i++){const positions=new Float32Array(768*3);for(let v=0;v<768;v+=3)positions.set([-.5,-.5,0,.5,-.5,0,0,.5,0],v*3);const geometry=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3)),mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({visible:false,color:0x00ff00}));mesh.frustumCulled=false;scene.add(mesh);hidden.push(mesh)}
  hidden[0].add(new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial({color:0x00ff00})));
  r.render(scene,camera);const gl=r.getContext(),original=gl.bufferSubData;let calls=0,bytes=0;
  gl.bufferSubData=function(...args){calls++;bytes+=args[2].byteLength;return original.apply(this,args)};
  for(let frame=0;frame<30;frame++){for(const mesh of hidden)mesh.geometry.attributes.position.needsUpdate=true;r.render(scene,camera)}
  const pixel=new Uint8Array(4);gl.readPixels(8,8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const drawsHidden=r.info.render.calls;
  gl.bufferSubData=original;for(const mesh of hidden)mesh.material.visible=true;r.render(scene,camera);const drawsRevealed=r.info.render.calls,glError=gl.getError();scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose()});r.dispose();r.forceContextLoss();
  return{hiddenMeshes:128,dirtyFrames:30,bufferSubDataCalls:calls,logicalPayloadBytes:bytes,pixel:Array.from(pixel),drawsHidden,drawsRevealed,glError};
 });
 await writeFile(join(out,'engine-hidden-upload-'+variant+'.json'),JSON.stringify({variant,sourceRef:process.env.BENCH_ENGINE_REF,browser:browser.version(),scope:'Synthetic engine operation-count probe; not Janus CPU timing or physical GPU bandwidth.',result},null,2));console.log(JSON.stringify({variant,result}));succeeded=true;
}finally{await finishBrowser({browser,browserServer,vite:server,succeeded})}
