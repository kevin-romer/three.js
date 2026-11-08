import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
for(const variant of ['r187','fork'])await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'interaction-checks.mjs'),app,three,out,variant],{env:{...process.env,BENCH_RUN:JSON.stringify({label:'interactions-'+variant,frames:3,warmup:0,correctness:false,behavior:true})},stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(variant+' interactions failed '+code)))});
