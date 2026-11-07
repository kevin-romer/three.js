import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json'));
const {chromium,firefox,webkit}=require(process.env.PLAYWRIGHT_ROOT ? resolve(process.env.PLAYWRIGHT_ROOT) : 'playwright');
const qunit=await readFile(join(out,'qunit.min.js'),'utf8');
const devRef=process.env.AUDIT_DEV_REF??'f2b6a71bdd088d9da387fcc62802323341099b92';
const changes=execFileSync('git',['diff','--name-only','--diff-filter=ACMR','r187',devRef,'--','src','test/unit','examples/jsm'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean);
const overlay=new Map();
for(const file of changes)overlay.set(file,execFileSync('git',['show',devRef+':'+file],{cwd:repo,maxBuffer:20*1024*1024}));
const mime={'.js':'text/javascript','.html':'text/html','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.wasm':'application/wasm'};
const hook=`
window.__auditTests=[]; window.__auditBackends=[];
QUnit.on('testEnd',test=>window.__auditTests.push({name:test.fullName.join(' > '),status:test.status,runtimeMs:test.runtime,softSkips:(test.assertions??[]).filter(value=>String(value.message).startsWith('SKIPPED:')).map(value=>value.message),errors:test.errors.map(error=>({message:error.message,stack:error.stack}))}));
QUnit.on('runEnd',result=>window.__auditDone={counts:result.testCounts,runtimeMs:result.runtime});
`;
const cases=process.env.AUDIT_QUUNIT_CASES?JSON.parse(process.env.AUDIT_QUUNIT_CASES):
 [{engine:'chrome',version:'r187',suite:'core'},{engine:'chrome',version:'r187',suite:'addons'},
 {engine:'chrome',version:'dev',suite:'core'},{engine:'chrome',version:'dev',suite:'addons'}];
for(const testCase of cases){
 const launcher={chrome:chromium,firefox,webkit}[testCase.engine];
 const browser=await launcher.launch({headless:true,...(testCase.engine==='chrome'?{channel:'chrome',args:['--enable-gpu','--use-angle=metal']}:{})});
 const page=await browser.newPage();
 const errors=[],missing=[],external=[],warnings=[];
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(/gpu-test-utils|not available, running under WebGL2/.test(message.text()))warnings.push(message.text())});
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.protocol==='blob:'||url.protocol==='data:'){await route.continue();return}
  if(url.hostname==='cdn.jsdelivr.net'){
   if(url.pathname.endsWith('qunit.min.js')){await route.fulfill({contentType:'text/javascript',body:qunit+'\n'+hook});return}
   if(url.pathname.endsWith('qunit.css')){await route.fulfill({contentType:'text/css',body:''});return}
  }
  if(url.hostname!=='three-audit.test'){external.push(url.origin+url.pathname);await route.abort();return}
  const name=decodeURIComponent(url.pathname).replace(/^\//,'');
  if(name.includes('..')){await route.abort();return}
  try{
   let bytes=testCase.version==='dev'&&overlay.has(name)?overlay.get(name):await readFile(join(repo,name));
   if(name==='test/unit/src/nodes/tsl/gpu-test-utils.js'){
    bytes=bytes.toString().replace('await renderer.init();', 'await renderer.init();\n window.__auditBackends.push({requested:backend,actual:renderer.backend.isWebGPUBackend?"webgpu":"webgl"});');
   }
   await route.fulfill({contentType:mime[extname(name)]??'application/octet-stream',body:bytes});
  }catch(error){missing.push(name);await route.fulfill({status:404,body:'Not found'})}
 });
 let cdp;
 if(testCase.engine==='chrome'){cdp=await page.context().newCDPSession(page);await cdp.send('Profiler.enable');await cdp.send('Profiler.startPreciseCoverage',{callCount:true,detailed:true})}
 const started=new Date().toISOString();
 try{
  const html=testCase.suite==='core'?'UnitTests.html':'UnitTestsAddons.html';
  await page.goto('https://three-audit.test/test/unit/'+html+'?seed=three-audit',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__auditDone,undefined,{timeout:240000});
  const data=await page.evaluate(()=>({result:window.__auditDone,tests:window.__auditTests,backends:window.__auditBackends}));
  const record={...testCase,browser:browser.version(),started,completed:new Date().toISOString(),...data,errors,missing,external,warnings};
  const stem='qunit-'+testCase.engine+'-'+testCase.version+'-'+testCase.suite;
  await writeFile(join(out,stem+'.json'),JSON.stringify(record,null,2)+'\n');
  if(cdp){const coverage=await cdp.send('Profiler.takePreciseCoverage');await writeFile(join(out,stem+'-coverage.json.gz'),gzipSync(JSON.stringify(coverage)))}
  console.log(stem,JSON.stringify({counts:data.result.counts,runtimeMs:data.result.runtimeMs,errors,missing,external,backends:data.backends,softSkipped:data.tests.filter(test=>test.softSkips?.length).length,failed:data.tests.filter(test=>test.status==='failed').map(test=>({name:test.name,message:test.errors[0]?.message})).slice(0,12)}));
 }catch(error){
  const record={...testCase,browser:browser.version(),started,error:String(error),errors,missing,external};
  await writeFile(join(out,'qunit-'+testCase.engine+'-'+testCase.version+'-'+testCase.suite+'-incomplete.json'),JSON.stringify(record,null,2)+'\n');
  console.log('INCOMPLETE',JSON.stringify(record));
 }finally{await page.close();await browser.close()}
}
