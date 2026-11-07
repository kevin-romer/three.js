import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import {createRequire} from 'node:module';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json')),{chromium}=require(process.env.PLAYWRIGHT_ROOT?resolve(process.env.PLAYWRIGHT_ROOT):'playwright');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-gpu','--use-angle=metal']});
const modes=[{name:'node-material',builds:10000},{name:'material-instance',builds:1},{name:'shader-material',webgl:true}],samples=[];
try{
 for(let run=0;run<3;run++)for(const mode of [...modes.slice(run),...modes.slice(0,run)]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());if(url.hostname!=='material-audit.test'){await route.abort();return}
   const file=decodeURIComponent(url.pathname).slice(1);if(file.includes('..')){await route.abort();return}
   try{await route.fulfill({contentType:extname(file)==='.html'?'text/html':'text/javascript',body:await readFile(join(repo,file))})}catch{await route.fulfill({status:404,body:''})}
  });
  try{
   await page.goto('https://material-audit.test/test/benchmarks/node-material-instance/'+mode.name+'.html');
   await page.waitForFunction(()=>window.benchmarkResults!==undefined,undefined,{timeout:120000});
   await page.click('#update');await page.waitForFunction(()=>window.benchmarkResults.uniformRender!==undefined);
   const result=await page.evaluate(()=>window.benchmarkResults);
   assert.deepEqual(errors,[]);assert.equal(result.count,10000);assert(result.drawCalls>=10000);
   if(mode.webgl){assert.equal(result.backend,'WebGLRenderer');assert.equal(result.drawCalls,10000);assert.equal(result.firstPrograms,1);assert.equal(result.updatePrograms,0)}
   else{assert.equal(result.backend,'WebGPU');assert.equal(result.firstBuilds,mode.builds);assert.equal(result.updateBuilds,0)}
   samples.push({run:run+1,mode:mode.name,...result});console.log(JSON.stringify(samples.at(-1)));
  }finally{await page.close()}
 }
 await writeFile(join(out,'material-benchmark.json'),JSON.stringify({browser:browser.version(),runs:3,timing:'CPU including submission; GPU completion not timed',samples},null,2)+'\n');
}finally{await browser.close()}
