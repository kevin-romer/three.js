import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json')),{rollup}=require('rollup');
const {default:configs}=await import(pathToFileURL(join(repo,'utils/build/rollup.config.js')));
const target=join(out,'rebuilt');await mkdir(target,{recursive:true});
const warnings=[];
for(const config of configs){
 const {output,...input}=config;
 const bundle=await rollup({...input,onwarn:warning=>warnings.push({code:warning.code,message:warning.message.split(repo).join('<repo>')})});
 for(const options of output)await bundle.write({...options,dir:target});
 await bundle.close();
}
const files=[];
for(const name of await readdir(target)){
 const rebuilt=await readFile(join(target,name));let published;
 try{published=await readFile(join(repo,'build',name))}catch{}
 files.push({name,bytes:rebuilt.length,sha256:createHash('sha256').update(rebuilt).digest('hex'),matchesPublished:published?rebuilt.equals(published):null,publishedBytes:published?.length??null});
}
await writeFile(join(out,'build-results.json'),JSON.stringify({node:process.version,files,warnings},null,2)+'\n');
console.log(JSON.stringify({files,warnings:warnings.length},null,2));
