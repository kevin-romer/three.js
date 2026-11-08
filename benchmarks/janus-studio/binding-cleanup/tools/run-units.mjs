import {spawn} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const [repo,out,mode='focused']=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url));
const cases=mode==='full'?[{engine:'chrome',version:'binding-full',suite:'core'},{engine:'chrome',version:'binding-full',suite:'addons'}]:[{engine:'chrome',version:'binding',suite:'core'},{engine:'firefox',version:'binding',suite:'core'},{engine:'webkit',version:'binding',suite:'core'}];
for(const item of cases)await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'qunit-progress.mjs'),repo,out],{env:{...process.env,AUDIT_QUUNIT_CASES:JSON.stringify([item]),BENCH_TEST_FILTER:mode==='full'?'':'WebGL'},stdio:'inherit'});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error(JSON.stringify(item)+' exit '+c)))});
