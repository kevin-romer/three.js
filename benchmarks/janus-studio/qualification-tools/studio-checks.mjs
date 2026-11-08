import {rememberBrowser,finishBrowser} from './managed-browser.mjs';
import {startJanusServer} from './janus-server.mjs';
import {loadFixtures} from './product-fixtures.mjs';
import {measureMap} from './measure-map.mjs';
import {studioCorrectness} from './studio-correctness.mjs';
import {instrumentResources} from './instrument-resources.mjs';
import {instrumentRendererListeners} from './renderer-listeners.mjs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {writeFile} from 'node:fs/promises';
const [appArg,threeArg,outArg,variant='r187']=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg);
const config=JSON.parse(process.env.BENCH_RUN??'{}'),label=config.label??('studio-synthetic-'+variant);
if(!/^[a-z0-9-]+$/.test(label))throw Error('Invalid output label');
const require=createRequire(join(app,'package.json')),playwright=require('playwright');
const {server,origin,served,fixtureConfig}=await startJanusServer({app,three,out,variant,css:true,preTransformRequests:false});
let runSucceeded=false;let browser,browserServer,page,heapSession,collectHeap,beforeBehaviorHeap;const deadline=setTimeout(()=>void browserServer?.kill(),240000);
try{
 console.log('SYNTHETIC_STUDIO_START',variant);
 let fixture=await loadFixtures(app,out);
 const browserType=config.browser??'chromium';browserServer=await playwright[browserType].launchServer(browserType==='chromium'?{host:'127.0.0.1',channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']}:{host:'127.0.0.1',headless:true});await rememberBrowser(browserServer,out);browser=await playwright[browserType].connect(browserServer.wsEndpoint());
 page=await browser.newPage({baseURL:origin,viewport:config.viewport??{width:1440,height:900}});const errors=[],logs=[];
 if(config.cpuRate){const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:config.cpuRate})}
 page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE_ERROR',e.message)});
 page.on('console',m=>{if(m.type()==='error'){logs.push(m.text());console.log('CONSOLE_ERROR',m.text().slice(0,150))}});
 await page.route('**/*',async route=>{const url=route.request().url();if(url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:'))return route.continue();return route.abort()});
 await fixture.prepareReact(page,'/__three_bench');if(config.resources)await page.evaluate(instrumentResources);if(config.rendererListeners)await page.evaluate(instrumentRendererListeners);console.log('PREPARED');
 const token=await page.evaluate(async()=>{const m=await import('/src/features/auth/auth0Organization.ts');const org=m.getCurrentAuth0AccessTokenOrganizationId();const e=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');return e({alg:'none'})+'.'+e({exp:4102444800,...(org?{org_id:org}:{})})+'.fixture-signature'});
 fixtureConfig.token=token;fixture=await loadFixtures(app,out,{fixtureToken:token});
 await fixture.fulfillReadOnlyActivation(page);await fixture.fulfillEmptyScenarioBranch(page,true);
 await page.evaluate(async()=>{
  const {default:native}=await import('/src/config/gis/nativeMapRuntime.ts');globalThis.__benchMaps=[];
  const on=native.Map.prototype.on;native.Map.prototype.on=function(...args){if(!__benchMaps.includes(this))__benchMaps.push(this);return on.apply(this,args)};
  const {TesseraMapRuntime}=await import('/src/features/external/tessera/map-runtime/TesseraMapRuntime.ts');globalThis.__benchRuntimes=[];
  const mount=TesseraMapRuntime.prototype.mount;TesseraMapRuntime.prototype.mount=function(...args){const result=mount.apply(this,args);__benchRuntimes.push(this);return result};
 });
 const mountStart=performance.now();await fixture.mountScenarioWorkspace(page);await page.getByRole('heading',{name:'Connector Alternative',exact:true}).waitFor();
 await page.waitForFunction(()=>__benchRuntimes?.some(r=>r.mounted)&&__benchMaps?.some(m=>m.isStyleLoaded()),{},{timeout:30000});console.log('WORKSPACE_MOUNTED');
 const workspaceReadyMs=performance.now()-mountStart;const dataStart=performance.now();
 const data=await page.evaluate(async({count=400})=>{
  const runtime=__benchRuntimes.find(r=>r.mounted),features=[];
  for(let i=0;i<count;i++){const x=i%20,y=Math.floor(i/20),lng=-77.05+(x-10)*.000075,lat=38.8+(y-10)*.00006;features.push({type:'Feature',id:'p'+i,properties:{scenario_object_id:'p'+i,height:10+i%5},geometry:{type:'Polygon',coordinates:[[[lng,lat],[lng+.000055,lat],[lng+.000055,lat+.00004],[lng,lat+.00004],[lng,lat]]]}})}
  const collection=globalThis.__benchDataset={type:'FeatureCollection',features},hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(collection))))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const binding={kind:'synthetic',key:'janus-performance-fixture:'+hash,sourceGenerationId:hash,sourceHashes:{fixture:hash},tenantId:null,subjectId:null,accessEpoch:null,consistencyBundleId:null,expiresAtMs:null};
  const source={sourceId:'benchmark-parcels',specification:{type:'geojson',data:collection,promoteId:'scenario_object_id',nativeBinding:binding,nativeMetadata:{classification:'UNADMITTED_DATA',authoritative:false}}};
  runtime.upsertLayer({layerId:'benchmark-parcels-fill',owner:'scenario',pickable:true,order:10,payload:{source,layer:{id:'benchmark-parcels-fill',source:'benchmark-parcels',type:'fill',paint:{'fill-color':['case',['boolean',['feature-state','selected'],false],'#ffca22','#22d3ee'],'fill-opacity':.7,'fill-outline-color':'#164e63'}},entityKind:'parcel',identityProperty:'scenario_object_id',entityRefPrefix:'parcel'}});
  runtime.setCamera({longitude:-77.05,latitude:38.8,zoom:17,bearing:-18,pitch:0});
  return{hash,count:features.length,classification:'synthetic-unadmitted',bindingKeyLength:binding.key.length};
 },config);console.log('DATA_INSTALLED',JSON.stringify(data));
 await page.waitForFunction(()=>__benchMaps.some(m=>{try{return m.getNativeFrame()&&m.queryRenderedFeatures({layers:['benchmark-parcels-fill']}).length>0}catch{return false}}),{},{timeout:30000});
 const nonemptyDataReadyMs=performance.now()-dataStart;console.log('USEFUL_FRAME');
 let cdp;if(config.profile){cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.start')}
 const result=await page.evaluate(measureMap,{warmup:config.warmup??120,frames:config.frames??300,correctness:config.correctness??true,diagnostics:config.diagnostics??false});
 if(cdp){const {profile}=await cdp.send('Profiler.stop');await writeFile(join(out,label+'.cpuprofile'),JSON.stringify(profile));await cdp.send('Profiler.disable');await cdp.detach()}
 if(config.behavior){heapSession=await page.context().newCDPSession(page);await heapSession.send('Performance.enable');collectHeap=async()=>{await heapSession.send('HeapProfiler.collectGarbage');await new Promise(resolve=>setTimeout(resolve,50));await heapSession.send('HeapProfiler.collectGarbage');const {metrics}=await heapSession.send('Performance.getMetrics');return Object.fromEntries(metrics.filter(m=>['JSHeapUsedSize','Nodes','Documents','JSEventListeners'].includes(m.name)).map(m=>[m.name,m.value]))};await page.exposeFunction('__benchCollectGarbage',collectHeap);beforeBehaviorHeap=await collectHeap()} const batches=[];if(config.behavior)for(let i=0;i<(config.heapBatches??1);i++){const checks=await page.evaluate(studioCorrectness);const afterReturnHeap=await collectHeap();batches.push({checks,afterReturnHeap})}
 const behavior=batches[0]?.checks??null,heap={before:beforeBehaviorHeap,batches:batches.map(b=>b.afterReturnHeap)};
 const disposal=(config.resources||config.rendererListeners)?await page.evaluate(()=>{const maps=[...__benchMaps],errors=[];const describe=e=>({name:e.name,message:e.message,stack:e.stack,errors:e.errors?.map(describe)});for(const r of __benchRuntimes)if(r.mounted)try{r.destroy()}catch(e){errors.push(describe(e))}const listeners=maps.map(m=>({listeners:[...m.listeners.values()].reduce((n,s)=>n+s.size,0),delegated:m.delegated.size}));globalThis.__benchMaps=[];globalThis.__benchRuntimes=[];const counts=globalThis.__benchResources?structuredClone(__benchResources.counts):null;globalThis.__benchResources?.restore();return{counts,listeners,rendererListeners:globalThis.__rendererListenerAudit?.snapshot()??null,renderers:__threeBench.renderers.length,errors}}):null;
 await page.screenshot({path:join(out,label+'.png')});
 await writeFile(join(out,label+'.json'),JSON.stringify({variant,label,config,started:new Date().toISOString(),browser:browser.version(),startup:{workspaceReadyMs,nonemptyDataReadyMs},data,result,behavior,heap,disposal,errors,logs,appSources:Object.fromEntries([...served].sort())},null,2));
 runSucceeded=true;console.log('RESULT',JSON.stringify({variant,data,metrics:result.metrics,frames:result.frames,errors,glError:result.glError,pixels:result.pixels.map(p=>p.sha256)}));
}catch(error){console.log('ERROR',String(error));if(page){await page.screenshot({path:join(out,label+'-failure.png')}).catch(()=>{});await writeFile(join(out,label+'-failure.txt'),await page.locator('body').innerText().catch(()=>''))}throw error}
finally{clearTimeout(deadline);await heapSession?.detach().catch(()=>{});await page?.close().catch(()=>{});await finishBrowser({browser,browserServer,vite:server,succeeded:runSucceeded})}
