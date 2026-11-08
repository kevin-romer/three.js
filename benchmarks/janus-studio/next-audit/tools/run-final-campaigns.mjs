import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
const base='2099f6f8c9aba5957567ac6186f5a9eb274bdb75',e02='e2c4394c7c528dbae5607132fb0218414eec7e95',c09='bd07567b61110c675350c57f9df46980ae91a055';
async function run(file,args){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,file),...args],{env:{...process.env,BENCH_APP_MANIFEST:join(out,'private-app-source-manifest.json')},stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error(file+' exited '+c)))})}
for(const [stage,control,candidate,scene]of [['e02-frozen',base,e02,'studio'],['e02-frozen',base,e02,'buildings'],['c09',e02,c09,'studio']]){
 await run('next-paired.mjs',[app,three,out,stage,control,candidate,scene,'timing']);
 await run('analyze-next.mjs',[out,stage,scene]);
}
console.log('ALL_FROZEN_CAMPAIGNS_COMPLETE');
