import {readdir,readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json')),espree=require('espree');
const files=[];
async function visit(dir){for(const entry of await readdir(join(repo,dir),{withFileTypes:true})){const name=dir+'/'+entry.name;if(entry.isDirectory()){if(!/(\/libs|\/vendor|\/3rdparty)(\/|$)/.test(name))await visit(name)}else if(entry.name.endsWith('.js'))files.push(name)}}
for(const dir of ['src','examples/jsm','test/unit','editor/js','tsl/js','utils'])await visit(dir);
const rows=[],parseErrors=[];
function member(node){if(!node)return'';if(node.type==='Identifier')return node.name;if(node.type==='MemberExpression')return member(node.object)+'.'+(node.property.name??node.property.value??'');return''}
for(const file of files){
 const source=await readFile(join(repo,file),'utf8');
 const row={file,bytes:Buffer.byteLength(source),lines:source.split('\n').length,sha256:createHash('sha256').update(source).digest('hex'),functions:0,tests:0,todos:0,skips:0,imports:[]};
 try{
  const ast=espree.parse(source,{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}});
  const stack=[ast];
  while(stack.length){
   const n=stack.pop();
   if(/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type))row.functions++;
   if(n.type==='ImportDeclaration'&&typeof n.source.value==='string')row.imports.push(n.source.value);
   if(n.type==='CallExpression'){
    const name=member(n.callee);
    if(name==='QUnit.test')row.tests++;
    if(name==='QUnit.todo'||name==='QUnit.test.todo')row.todos++;
    if(name==='QUnit.skip'||name==='QUnit.test.skip')row.skips++;
   }
   for(const value of Object.values(n)){if(Array.isArray(value)){for(const child of value)if(child&&typeof child.type==='string')stack.push(child)}else if(value&&typeof value.type==='string')stack.push(value)}
  }
 }catch(error){parseErrors.push({file,error:error.message})}
 rows.push(row);
}
const groups={};
for(const row of rows){const parts=row.file.split('/');const group=parts[0]==='src'?(parts.length>2?'src/'+parts[1]:'src/entrypoints'):row.file.startsWith('examples/jsm')?'addons/'+parts[2]:row.file.startsWith('test/unit')?'test/unit':parts[0];
 const g=groups[group]??={files:0,lines:0,bytes:0,functions:0,testDeclarations:0,todoDeclarations:0};
 g.files++;for(const key of ['lines','bytes','functions'])g[key]+=row[key];g.testDeclarations+=row.tests;g.todoDeclarations+=row.todos;
}
await writeFile(join(out,'source-census.json'),JSON.stringify({roots:['src','examples/jsm','test/unit','editor/js','tsl/js','utils'],excluded:['vendored libs','binary assets','generated builds','docs translations'],groups,parseErrors,files:rows},null,2)+'\n');
console.log(rows.length,'JavaScript files;',parseErrors.length,'parse errors');
console.table(groups);
