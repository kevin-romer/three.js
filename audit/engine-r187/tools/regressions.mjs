import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transform } from './candidates.mjs';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg),rows=[];
let current='upstream';
globalThis.QUnit={
 module(name,callback){callback()},
 test(name,callback){
  callback({ok:assert.ok,strictEqual:assert.strictEqual,throws:assert.throws});
  rows.push({variant:current,name,status:'passed'});
 }
};
const base=join(repo,'src/objects/BatchedMesh.js'),test=join(repo,'test/unit/src/objects/BatchedMesh.tests.js');
for(current of ['upstream','sparse-batch','stable-indirect','free-id-heap','resize-batch']){
 const source=transform(await readFile(base,'utf8'),'src/objects/BatchedMesh.js',current).replace(/from '([^']+)'/g,
  (match,spec)=>"from '"+pathToFileURL(resolve(dirname(base),spec)).href+"'");
 const modified=join(dirname(out),'regression-'+current+'.mjs');await writeFile(modified,source);
 const testSource=(await readFile(test,'utf8')).replace(/from '([^']+)'/g,(match,spec)=>{
  const destination=spec.endsWith('/BatchedMesh.js')?modified:resolve(dirname(test),spec);
  return "from '"+pathToFileURL(destination).href+"'";
 });
 const testFile=join(dirname(out),'test-'+current+'.mjs');await writeFile(testFile,testSource);
 await import(pathToFileURL(testFile));
}
await writeFile(out,JSON.stringify({runner:'Node assert adapter executing the two existing upstream QUnit test bodies; not the full QUnit harness',tests:rows},null,2)+'\n');
console.log(rows.length,'existing upstream BatchedMesh regression executions passed');
