import {startJanusServer} from './janus-server.mjs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const [appArg,threeArg,outArg]=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),require=createRequire(join(app,'package.json')),{chromium}=require('playwright'),runs=[];
for(let round=0;round<5;round++)for(const variant of round%2?['fork-default','fork','r187']:['r187','fork','fork-default']){
 const {server,origin}=await startJanusServer({app,three,out,variant});let browser;
 try{
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});const page=await browser.newPage({viewport:{width:512,height:512}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/__three_bench');
  const result=await page.evaluate(async({url,budget})=>{
   const T=await import(url),r=new T.WebGLRenderer({antialias:false,maxInactivePrograms:budget});r.setSize(512,512,false);document.body.append(r.domElement);
   const g=new T.BoxGeometry(.7,.7,.7),m=new T.MeshBasicMaterial({color:0x22aaff}),s=new T.Scene(),c=new T.PerspectiveCamera(45,1,.1,200);c.position.set(0,0,65);
   for(let i=0;i<1000;i++){const mesh=new T.Mesh(g,m);mesh.position.set(i%32-16,Math.floor(i/32)-16,0);s.add(mesh)}
   const frames=[];for(let i=-120;i<300;i++){await new Promise(requestAnimationFrame);s.rotation.z=Math.sin(i*.01)*.03;const start=performance.now();r.render(s,c);if(i>=0)frames.push(performance.now()-start)}
   const gl=r.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info'),bytes=new Uint8Array(512*512*4);gl.readPixels(0,0,512,512,gl.RGBA,gl.UNSIGNED_BYTE,bytes);if(!bytes.some(Boolean)||gl.getError())throw Error('Invalid stable-scene pixels');
   const pixels=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join(''),draws=r.info.render.calls,programs=r.info.programs.length,device=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
   const sorted=[...frames].sort((a,b)=>a-b),metrics={p50:sorted[149],p95:sorted[284],p99:sorted[296],max:sorted.at(-1)};
   g.dispose();m.dispose();r.dispose();if(r.info.programs.length)throw Error('Stable scene programs retained after dispose');r.forceContextLoss();r.domElement.remove();return{frames,warmup:120,metrics,pixels,draws,programs,device};
  },{url:'/@fs'+three+'/src/Three.js',budget:variant==='fork'?16:0});assert.equal(errors.length,0);assert.equal(result.draws,1000);runs.push({round:round+1,variant,browser:browser.version(),result,errors});console.log('STABLE_SCENE',JSON.stringify({round:round+1,variant,metrics:result.metrics}));await writeFile(join(out,'stable-scene.json'),JSON.stringify({runs},null,2));
 }finally{await browser?.close();await server.close()}
}
for(let i=1;i<=5;i++){const round=runs.filter(r=>r.round===i);assert.equal(new Set(round.map(r=>r.result.pixels)).size,1)}
