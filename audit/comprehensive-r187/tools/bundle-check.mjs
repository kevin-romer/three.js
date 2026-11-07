import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const [repoArg,outArg]=process.argv.slice(2),repo=resolve(repoArg),out=resolve(outArg);
const require=createRequire(join(repo,'package.json')),{rollup}=require('rollup');
const {default:configs}=await import(pathToFileURL(join(repo,'test/rollup.treeshake.config.js')));
const target=join(out,'bundles');await mkdir(target,{recursive:true});
const warnings=[],files=[];
for(const config of configs){
 const {output,...input}=config;
 const bundle=await rollup({...input,onwarn:warning=>warnings.push({code:warning.code,message:warning.message.split(repo).join('<repo>')})});
 for(const options of output){
  const file=join(target,basename(options.file));await bundle.write({...options,file});
  const bytes=await readFile(file);files.push({name:basename(file),bytes:bytes.length,gzipBytes:gzipSync(bytes).length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 await bundle.close();
}
await writeFile(join(out,'bundle-results.json'),JSON.stringify({node:process.version,files,warnings},null,2)+'\n');
console.log(JSON.stringify({configurations:files.length,warnings:warnings.length}));
