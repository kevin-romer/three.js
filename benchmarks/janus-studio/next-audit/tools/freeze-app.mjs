// Copies only modules discovered by local probe runs. Keep output private.
import {readFile,writeFile,mkdir,copyFile,symlink,stat} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [appArg,threeArg,outArg,...records]=process.argv.slice(2),app=resolve(appArg),three=resolve(threeArg),out=resolve(outArg),target=join(out,'private-app');
for(const source of [app,three])assert.ok(relative(source,out).startsWith('..'),'Output must be outside source repositories');
const files=new Set(['package.json','package-lock.json','index.html','e2e/janus-scenario-studio-workspace.spec.ts']);
for(const name of records){const run=JSON.parse(await readFile(name));assert.ok(run.appSources,'Use private unsanitized discovery records');for(const file of Object.keys(run.appSources)){assert.ok(!file.startsWith('/')&&!file.split('/').includes('..'));files.add(file)}}
const sha=b=>createHash('sha256').update(b).digest('hex');
async function hashFiles(root){const values={};for(const file of [...files].sort())values[file]=sha(await readFile(join(root,file)));return values}
await mkdir(target,{recursive:true});let manifest;
for(let attempt=0;attempt<3;attempt++){
 const before=await hashFiles(app);
 for(const file of files){const path=join(target,file);await mkdir(dirname(path),{recursive:true});await copyFile(join(app,file),path)}
 const after=await hashFiles(app),copied=await hashFiles(target);
 if(JSON.stringify(before)===JSON.stringify(after)&&JSON.stringify(before)===JSON.stringify(copied)){manifest=before;break}
}
assert.ok(manifest,'Application changed during three snapshot attempts');
try{await symlink(join(app,'node_modules'),join(target,'node_modules'),'dir')}catch(e){if(e.code!=='EEXIST')throw e}
// Controlled fixture environment stays private, alongside the copied sources.
for(const file of ['.env','.env.local','.env.development','.env.development.local']){try{if((await stat(join(app,file))).isFile())await copyFile(join(app,file),join(target,file))}catch(e){if(e.code!=='ENOENT')throw e}}
await writeFile(join(out,'private-app-source-manifest.json'),JSON.stringify({sourceFiles:manifest},null,2));
console.log(JSON.stringify({frozenFiles:files.size,sha256:sha(JSON.stringify(manifest))}));
