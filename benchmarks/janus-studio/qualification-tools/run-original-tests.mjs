import {startJanusServer} from './janus-server.mjs';
import {loadOriginalTest} from './original-tests.mjs';
import {loadFixtures} from './product-fixtures.mjs';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const [appArg,threeArg,outArg,variant='fork']=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),require=createRequire(join(app,'package.json')),{chromium}=require('playwright');
const {server,origin,fixtureConfig}=await startJanusServer({app,three,out,variant,css:true,preTransformRequests:false});let browser,context,page;
try{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
 context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:900}});page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const url=route.request().url();return url.startsWith(origin+'/')||url.startsWith('blob:')||url.startsWith('data:')?route.continue():route.abort()});
 const fixture=await loadFixtures(app,out);await fixture.prepareReact(page,'/__three_bench');
 const token=await page.evaluate(async()=>{const m=await import('/src/features/auth/auth0Organization.ts');const org=m.getCurrentAuth0AccessTokenOrganizationId();const e=v=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');return e({alg:'none'})+'.'+e({exp:4102444800,...(org?{org_id:org}:{})})+'.fixture-signature'});fixtureConfig.token=token;
 const results=[];
 for(const [file,name] of [['e2e/janus-scenario-studio-workspace.spec.ts','Scenario workspace keeps Janus product states over the Tessera runtime'],['e2e/janus-scenario-studio-workspace.spec.ts','Scenario workspace reflows at 320 CSS pixels and survives text spacing'],['e2e/janus-enhanced-performance.spec.ts','Enhanced 3D retains building detail during repeated zoom and pan']]){
  await page.setViewportSize({width:1440,height:900});const original=await loadOriginalTest(app,out,file,name,token),started=performance.now();
  let deadline;const expired=new Promise((_,reject)=>{globalThis.__originalTestDeadline=ms=>{clearTimeout(deadline);deadline=setTimeout(()=>reject(Error('Original test deadline exceeded')),ms)}});globalThis.__originalTestDeadline(120000);
  try{await Promise.race([original.runOriginalTest({page},{project:{name:variant},outputPath:name=>join(out,variant+'-original-'+name),attach:async()=>{}}),expired]);results.push({name,status:'passed',sourceSha256:original.sourceSha256,elapsedMs:performance.now()-started});console.log('ORIGINAL_TEST_PASSED',name)}catch(error){results.push({name,status:'failed',sourceSha256:original.sourceSha256,error:String(error),stack:error.stack});console.log('ORIGINAL_TEST_FAILED',name,String(error));}finally{clearTimeout(deadline);delete globalThis.__originalTestDeadline;}
 }
 await writeFile(join(out,variant+'-original-tests.json'),JSON.stringify({variant,browser:browser.version(),results,errors},null,2));if(results.some(r=>r.status!=='passed')||errors.length)process.exitCode=1;
}finally{await context?.close();await browser?.close();const guard=setTimeout(()=>{console.error('VITE_SHUTDOWN_TIMEOUT_AFTER_BROWSER_CLOSED');server.httpServer?.closeAllConnections();server.httpServer?.close();process.exit(process.exitCode??0)},10000);await server.close();clearTimeout(guard)}
