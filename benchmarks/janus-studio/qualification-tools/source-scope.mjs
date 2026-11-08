import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const [repo,out]=process.argv.slice(2),require=createRequire(join(repo,'package.json')),{parse}=require('acorn');
const measured='ea87fa90a4211920f08120639189344c7f73bd96';
const files=['src/renderers/WebGLRenderer.js','src/renderers/webgl/WebGLPrograms.js','test/unit/three.source.unit.js','test/unit/src/renderers/webgl/WebGLPrograms.tests.js'];
const sha=x=>createHash('sha256').update(x).digest('hex');
const old=f=>execFileSync('git',['show',measured+':'+f],{cwd:repo});
const strip=x=>Array.isArray(x)?x.map(strip):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>!['start','end','raw'].includes(k)).map(([k,v])=>[k,strip(v)])):x;
const sources={},changed=[];
for(const file of files){const before=old(file),after=await readFile(join(repo,file));sources[file]={measured:sha(before),final:sha(after)};if(file.endsWith('WebGLPrograms.js')){
 const a=parse(before.toString(),{ecmaVersion:'latest',sourceType:'module'}),b=parse(after.toString(),{ecmaVersion:'latest',sourceType:'module'});
 for(const tree of [a,b]){const root=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='WebGLPrograms');for(let i=0;i<root.body.body.length;i++){const n=root.body.body[i];if(n.type==='FunctionDeclaration'&&['destroyProgram','dispose'].includes(n.id.name)){if(tree===a)changed.push(n.id.name);root.body.body[i]={type:'QualifiedColdFunction',name:n.id.name}}}}
 assert.deepEqual(strip(a),strip(b),'Unexpected change outside bulk destruction helpers');
}else assert.equal(sha(before),sha(after),'Unexpected renderer/test change');}
const result={measuredEngineCommit:measured,finalEngineCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sources,changedFunctions:changed,scope:'AST comparison removes only destroyProgram and dispose declarations; the rest of WebGLPrograms is identical. WebGLRenderer and regression test files are byte-identical. Performance campaigns remain attributed to the measured commit; later bulk disposal is independently checked with real GL programs.',passed:true};
await writeFile(join(out,'final-source-scope.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:true,changedFunctions:changed}));
