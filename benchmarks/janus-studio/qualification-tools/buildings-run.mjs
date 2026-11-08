import {rememberBrowser,finishBrowser} from './managed-browser.mjs';
import {startJanusServer} from './janus-server.mjs';
import {measureMap} from './measure-map.mjs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
const [appArg,threeArg,outArg,variant='r187']=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),config=JSON.parse(process.env.BENCH_RUN??'{}'),label=config.label??'buildings-'+variant;
const require=createRequire(join(app,'package.json')),{chromium}=require('playwright');
const {server,origin,served}=await startJanusServer({app,three,out,variant});let runSucceeded=false;let browser,browserServer;
try{
 browserServer=await chromium.launchServer({host:'127.0.0.1',channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});await rememberBrowser(browserServer,out);browser=await chromium.connect(browserServer.wsEndpoint());const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],logs=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')logs.push(m.text())});
 await page.route('**/*',route=>{const url=route.request().url();return url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort()});
 await page.goto(origin+'/__three_bench');await page.waitForFunction(()=>globalThis.__benchReady);const start=performance.now();
 await page.evaluate(async()=>{const m=await import('/e2e/fixtures/illustrationHarness.tsx');await m.mountIllustrationHarness(45)});
 await page.waitForFunction(()=>globalThis.__illustrationHarness?.controller.snapshot().status.state==='ready'&&__illustrationHarness.map.getNativeFrame(),{},{timeout:90000});
 const datasetHash=await page.evaluate(()=>__illustrationHarness.map.getNativeBinding().sourceGenerationId);
 const startupMs=performance.now()-start,result=await page.evaluate(measureMap,{warmup:120,frames:config.frames??300,correctness:true,diagnostics:config.diagnostics??false});
 const picks=await page.evaluate(()=>{const h=__illustrationHarness;for(const e of h.controller.entries.values()){const s=e.compiled.source,ring=s.geometry.coordinates[0],n=ring.length-1,lng=ring.slice(0,-1).reduce((s,p)=>s+p[0],0)/n,lat=ring.slice(0,-1).reduce((s,p)=>s+p[1],0)/n,p=h.map.getNativeRuntime().viewport.project([lng,lat,s.height_m*.8]);if(p&&h.controller.pick(p)?.entityRef===s.entity_ref)return{visiblePick:true,expected:s.entity_ref}}throw Error('No correct visible building pick')});
 await page.evaluate(()=>__illustrationHarness.dispose());if(await page.evaluate(()=>__threeBench.renderers.length)!==0)throw Error('Renderer retained');
 await writeFile(join(out,label+'.json'),JSON.stringify({variant,label,config,browser:browser.version(),data:{hash:datasetHash,count:45,classification:'synthetic-building-renderer-fixture'},startup:{startupMs},result,picks,errors,logs,appSources:Object.fromEntries([...served].sort())},null,2));runSucceeded=true;console.log('BUILDINGS_RUN',JSON.stringify({variant,label,metrics:result.metrics.engineMs,models:result.models,retained:result.retained,picks,errors}));
}finally{await finishBrowser({browser,browserServer,vite:server,succeeded:runSucceeded})}
