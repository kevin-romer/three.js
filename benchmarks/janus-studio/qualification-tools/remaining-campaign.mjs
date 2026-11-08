import {spawn} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const [app,three,out]=process.argv.slice(2),root=dirname(fileURLToPath(import.meta.url)),complete=[];
for(const name of ['buildings','scale100','mobile']){
 for(const [script,args]of [['paired-runs.mjs',[app,three,out,name]],['analyze-pairs.mjs',[out,name]]]){
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,script),...args],{stdio:'inherit'});child.on('error',reject);child.on('exit',resolve)});if(code!==0)throw Error(name+' '+script+' exited '+code);
 }
 complete.push(name);await writeFile(join(out,'remaining-campaign.json'),JSON.stringify({complete},null,2));console.log('CAMPAIGN_CASE_COMPLETE',name);
}
