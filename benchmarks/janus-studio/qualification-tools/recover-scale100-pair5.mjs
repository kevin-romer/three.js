import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url)),hash=b=>createHash('sha256').update(b).digest('hex');
const expected=JSON.parse(await readFile(join(out,'scale100-pair4-r187.json'))).protocol;
const recoveryControllerSha256=hash(await readFile(fileURLToPath(import.meta.url)));
async function verify(){
 for(const [name,sha]of Object.entries(expected.tools))assert.equal(hash(await readFile(join(root,name))),sha,name);
 for(const [name,sha]of Object.entries(expected.engine))assert.equal(hash(await readFile(join(three,name))),sha,name);
 for(const [name,sha]of Object.entries(expected.applicationPackages))assert.equal(hash(await readFile(join(app,name))),sha,name);
 const helper=await readFile(join(app,'e2e/janus-scenario-studio-workspace.spec.ts'),'utf8');assert.equal(hash(helper.slice(0,helper.indexOf('test("Scenario workspace keeps'))),expected.fixtureHelperPrefixSha256);
 assert.equal(execFileSync('git',['log','-1','--format=%H','--','src'],{cwd:three,encoding:'utf8'}).trim(),expected.engineSourceCommit);
}
await verify();
for(const variant of ['r187','fork']){
 for(const extension of ['json','log','png'])try{await rename(join(out,'scale100-pair5-'+variant+'.'+extension),join(out,'excluded-startup-failure-scale100-pair5-'+variant+'.'+extension))}catch(error){if(error.code!=='ENOENT')throw error}
}
await writeFile(join(out,'scale100-recovery.json'),JSON.stringify({reason:'The original candidate browser closed during newPage setup before any frames were measured. Replaced the entire fifth pair to preserve temporal pairing, without selecting by timing.',recoveryControllerSha256},null,2));
for(const variant of ['r187','fork']){
 await verify();const label='scale100-pair5-'+variant;
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'studio-synthetic.mjs'),app,three,out,variant],{env:{...process.env,BENCH_RUN:JSON.stringify({count:100,label,frames:300,warmup:120})},stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)});assert.equal(code,0,label);await verify();
 const path=join(out,label+'.json'),x=JSON.parse(await readFile(path));x.protocol={...expected,recoveryControllerSha256};x.recovery='Entire pair replaced after an unmeasured browser startup failure.';await writeFile(path,JSON.stringify(x,null,2));console.log('RECOVERED_PAIR_MEMBER',label,x.result.metrics.engineMs.p95);
}
