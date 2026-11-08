// Own only the temporary browser started by this benchmark. Never touch user browsers.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
async function bounded(promise,ms){let timer;try{return await Promise.race([Promise.resolve(promise).then(()=>true,()=>false),new Promise(resolve=>timer=setTimeout(()=>resolve(false),ms))])}finally{clearTimeout(timer)}}
export async function rememberBrowser(server,out){
 const process=server.process(),path=join(out,'private-owned-browser-profiles.json');
 let records=[];try{records=JSON.parse(await readFile(path,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
 const arg=process.spawnargs.find(value=>value.startsWith('--user-data-dir='));records.push({pid:process.pid,userDataDir:arg?.slice('--user-data-dir='.length)??null,created:new Date().toISOString()});await writeFile(path,JSON.stringify(records,null,2));
}
export async function finishBrowser({browser,browserServer,vite,succeeded=true}){
 await bounded(browser?.close(),3000);
 let forceExit=false;
 if(browserServer){
  const child=browserServer.process(),closing=browserServer.kill();
  const closed=await bounded(closing,1000);
  if(child.exitCode===null&&child.signalCode===null){
   child.kill('SIGKILL');
   const exited=await bounded(new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)}),5000);
   if(!exited)throw Error('Owned benchmark browser did not terminate');
  }
  forceExit=!closed;
 }
 const viteClosed=await bounded(vite.close(),5000);
 if(!viteClosed){vite.httpServer?.closeAllConnections();vite.httpServer?.close();forceExit=true}
 if(forceExit){console.log('HARNESS_EXIT_AFTER_VERIFIED_BROWSER_TERMINATION');process.exit(succeeded?(process.exitCode??0):1)}
}
