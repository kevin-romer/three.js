import {startJanusServer} from './dispose-server.mjs';
import {rememberBrowser,finishBrowser} from './managed-browser.mjs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [appArg,threeArg,outArg]=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),require=createRequire(join(app,'package.json')),{chromium}=require('playwright'),runs=[];
for(const count of [128,512])for(const variant of count===128?['fork-before-dispose','fork']:['fork','fork-before-dispose']){
 const {server,origin}=await startJanusServer({app,three,out,variant});let browser,browserServer,succeeded=false;
 try{
  browserServer=await chromium.launchServer({host:'127.0.0.1',channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});await rememberBrowser(browserServer,out);browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/__three_bench');
  const result=await page.evaluate(async n=>{
   const T=await import('/@id/__x00__three-benchmark'),r=new T.WebGLRenderer({antialias:false}),s=new T.Scene(),c=new T.OrthographicCamera(-1,1,1,-1,.1,10);c.position.z=2;r.setSize(32,32,false);document.body.append(r.domElement);
   const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([-.8,-.8,0,.8,-.8,0,0,.8,0],3)),materials=[];
   for(let i=0;i<n;i++){const m=new T.ShaderMaterial({defines:{BENCH_ID:i},vertexShader:'void main(){gl_Position=vec4(position,1.0);}',fragmentShader:'void main(){gl_FragColor=vec4(0.0,1.0,0.0,1.0);}'});materials.push(m);s.add(new T.Mesh(g,m))}
   r.render(s,c);const gl=r.getContext(),pixel=new Uint8Array(4);gl.readPixels(16,16,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);if(pixel[1]!==255||gl.getError())throw Error('Expected green valid scene');
   const list=r.info.programs,initialPrograms=list.length;let searches=0,scannedElements=0,deletes=0;const remove=gl.deleteProgram;gl.deleteProgram=function(...args){deletes++;return remove.apply(this,args)};
   list.indexOf=function(...args){searches++;scannedElements+=this.length;return Array.prototype.indexOf.apply(this,args)};
   const start=performance.now();r.dispose();const disposeMs=performance.now()-start,remainingPrograms=list.length;delete list.indexOf;gl.deleteProgram=remove;
   for(const m of materials)m.dispose();g.dispose();const error=gl.getError();r.forceContextLoss();r.domElement.remove();return{count:n,initialPrograms,remainingPrograms,searches,scannedElements,deleteProgramCalls:deletes,disposeMs,pixel:[...pixel],glError:error};
  },count);assert.deepEqual(errors,[]);assert.equal(result.initialPrograms,count);assert.equal(result.remainingPrograms,0);assert.equal(result.deleteProgramCalls,count);assert.equal(result.glError,0);if(variant==='fork')assert.equal(result.searches,0);else assert.equal(result.scannedElements,count*(count+1)/2);runs.push({variant,browser:browser.version(),result});succeeded=true;console.log('DISPOSE_SCALING',JSON.stringify(runs.at(-1)));await writeFile(join(out,'dispose-scaling.json'),JSON.stringify({scope:'Real WebGL programs. Array-search work is counted; single-run native disposal times are diagnostic, not a qualified wall-time speedup.',runs},null,2));
 }finally{await finishBrowser({browser,browserServer,vite:server,succeeded})}
}
