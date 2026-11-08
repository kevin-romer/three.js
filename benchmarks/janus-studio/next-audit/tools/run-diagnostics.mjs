import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
const base='2099f6f8c9aba5957567ac6186f5a9eb274bdb75',e02='e2c4394c7c528dbae5607132fb0218414eec7e95',c09='bd07567b61110c675350c57f9df46980ae91a055';
const cases=[...['control','candidate'].map(variant=>({tool:'engine-hidden-upload.mjs',variant,ref:variant==='control'?base:e02})),...['control','candidate'].map(variant=>({tool:'engine-lifetime-gc.mjs',variant,ref:variant==='control'?e02:c09})),...['control','candidate'].map(variant=>({tool:'janus-lifetime-checks.mjs',variant,ref:variant==='control'?e02:c09,config:{label:'c09-lifetime-'+variant,frames:3,warmup:0,correctness:false,behavior:true}}))];
for(const item of cases)await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,item.tool),app,three,out,item.variant],{env:{...process.env,BENCH_ENGINE_REF:item.ref,...(item.config?{BENCH_RUN:JSON.stringify(item.config)}:{})},stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error(item.tool+' '+item.variant+' exit '+c)))});
