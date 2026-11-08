import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url)),results=[];
const cases=[...['firefox','webkit'].flatMap(browser=>['r187','fork'].map(variant=>({variant,label:'compat-'+browser+'-'+variant,browser}))),...['r187','fork'].map(variant=>({variant,label:'compat-mobile-'+variant,viewport:{width:390,height:844},cpuRate:4}))];
for(const item of cases){console.log('PLATFORM_SMOKE_START',item.label);const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'studio-checks.mjs'),app,three,out,item.variant],{env:{...process.env,BENCH_RUN:JSON.stringify({...item,frames:3,warmup:10,correctness:true})},stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)});results.push({case:item.label,exitCode:code});await writeFile(join(out,'platform-smokes.json'),JSON.stringify({results},null,2));console.log('PLATFORM_SMOKE_END',item.label,code)}
